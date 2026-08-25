import { google } from 'googleapis';
import { v1, v1p1beta1 } from '@google-cloud/asset';
import Redis from 'ioredis';

const assetClientv1 = new v1.AssetServiceClient();
//const assetClientv1p1beta1 = new v1p1beta1.AssetServiceClient();

const redis = new Redis(6379, 'redis');

function loadResources(parent) {
    return new Promise((resolve, reject) => {
        assetClientv1.listAssets({
            parent: parent,
            contentType: 'RESOURCE',
        }, (err, res) => {
            if (err) {
                reject(err);
            } else {
                const pipeResourcesRaw = redis.pipeline();
                const pipeResources = redis.pipeline();
                for (const resource of res) {
                    pipeResourcesRaw.call('JSON.SET', `resourceRaw:${resource.name}`, '$', JSON.stringify(resource));
                }
                for (const resource of preprocessResources(res)) {
                    pipeResourcesRaw.call('JSON.SET', `resources:${resource.fullResourceName}`, '$', JSON.stringify(resource));
                }

                Promise.all([pipeResourcesRaw.exec(),
                pipeResources.exec()])
                    .then(() => {
                        resolve(res);
                    })
                    .catch((err) => {
                        reject(err);
                    });
            }
        });
    });
}

function loadPolicies(parent) {
    return new Promise((resolve, reject) => {
        assetClientv1.searchAllIamPolicies({
            scope: parent,
        }, (err, res) => {
            if (err) {
                reject(err);
            } else {
                const pipePoliciesRaw = redis.pipeline();
                for (const policy of res) {
                    pipePoliciesRaw.call('JSON.SET', `policiesRaw:${policy.resource}`, '$', JSON.stringify(policy));
                }

                pipePoliciesRaw.exec()
                    .then(() => {
                        resolve(res);
                    })
                    .catch((err) => {
                        reject(err);
                    });
            }
        });
    });
}

function loadRoles(parent) {
    return new Promise((resolve, reject) => {
        // authenticate to google api
        google.auth.getClient({
            scopes: ['https://www.googleapis.com/auth/cloud-platform']
        }).then((authClient) => {
            //console.log(`auth OK ${JSON.stringify(authClient)}`);
            const googleIam = google.iam({ version: 'v1', auth: authClient });
            var rolesProcessed = {}; //roles data with permissions

            // fetches every page of googleIam.roles.list for the given params
            function fetchAllRoles(params, pageToken) {
                return googleIam.roles.list({
                    ...params,
                    pageToken: pageToken,
                }).then((res) => {
                    if (res.data.roles) {
                        res.data.roles.forEach((role) => {
                            rolesProcessed[role.name] = {
                                name: role.name,
                                title: role.title,
                                description: role.description,
                                stage: role.stage,
                                includedPermissions: role.includedPermissions
                            };
                        });
                    }
                    if (res.data.nextPageToken) {
                        return fetchAllRoles(params, res.data.nextPageToken);
                    }
                });
            }

            // get predefined roles from API
            const promiseRolesGlobal = fetchAllRoles({
                "view": "FULL",
            });

            //get custom roles from project/organization
            const promiseRolesProject = fetchAllRoles({
                "parent": parent,
                "view": "FULL",
            });

            Promise.all([promiseRolesGlobal, promiseRolesProject]).then(() => {
                const pipeRoles = redis.pipeline();
                for (const role of Object.values(rolesProcessed)) {
                    pipeRoles.call('JSON.SET', `roles:${role.name}`, '$', JSON.stringify(role));
                }

                pipeRoles.exec()
                    .then(() => {
                        resolve(rolesProcessed);
                    })
                    .catch((err) => {
                        reject(err);
                    });
            }).catch((err) => {
                reject(err);
            });
        }).catch((err) => {
            reject(err);
        });
    })
}


function formatResourceName(resource) {
    switch (resource.assetType) {
        case 'storage.googleapis.com/Bucket':
            return resource.resource.data.fields.id.stringValue;
        case 'iam.googleapis.com/ServiceAccount':
            return resource.resource.data.fields.email.stringValue;
        default:
            return trimApiFromResourceName(resource.name) ?? resource.name;
    }
} //formatResourceName()

function trimApiFromResourceName(resourceName) {
    let splitName = resourceName.split('/');
    if (splitName.length > 1 && splitName[3] === 'projects') {
        return splitName.slice(3).join('/');
    } else {
        return null;
    }
} //trimApiFromResourceName()

function preprocessResources(resources, skipSubResources = true) {
    const notResources = ['serviceusage.googleapis.com/Service'];


    let resourcesProcessed = [];
    resources.forEach((resource) => {
        if (!notResources.includes(resource.assetType) &&
            (!skipSubResources || resource.resource.parent.split('/').length <= 5)) {
            resourcesProcessed.push({
                fullResourceName: resource.name,
                displayName: formatResourceName(resource),
                type: resource.assetType,
                parent: trimApiFromResourceName(resource.resource.parent) ?? resource.resource.parent
            });
        }
    });
    return resourcesProcessed;
}

function preprocessPolicies(policies) {
    let policiesPerMember = [];
    policies.forEach((policy) => {
        //        console.log(policy);
        policy.policy.bindings.forEach((binding) => {
            //            console.log(binding);
            binding.members.forEach((member) => {
                // policy binding is identified uniquely by attachment point + role
                let policyId = `${trimApiFromResourceName(policy.resource)}::${binding.role}`;
                policiesPerMember.push({
                    attachmentPoint: policy.resource,
                    role: binding.role,
                    member: member,
                    condition: binding.condition
                });
            })
        })
    })
    return policiesPerMember;
}


function policiesToEntitlements(policies, roles) {
    function readPermissionCategory(permission) {
        //returns enum('list', 'read', 'write')
        const action = permission.split('.')[2];
        const catList = ['list'];
        const catRead = ['get', 'use'];

        if (catList.includes(action)) return 'list';
        if (catRead.includes(action)) return 'read';
        return 'write';
    }

    function serviceFromPermission(permission) {
        return permission.split('.')[0];
    }

    function isOrgUnit(fullResourceName) {
        const orgUnits = [
            '//cloudresourcemanager.googleapis.com/projects',
            '//cloudresourcemanager.googleapis.com/folders',
            '//cloudresourcemanager.googleapis.com/organizations'
        ];
        return orgUnits.includes(fullResourceName.split('/').slice(0, -1).join('/'));
    }

    function matchesApi(permission, fullResourceName) {
        const typeFromPermission = `//${permission.split('.')[1]}.googleapis.com/${permission.split('.')[1]}`;
        const typeFromResource = `//${fullResourceName.split('/')[2]}/${fullResourceName.split('/').at(-2)}`;
        return (typeFromPermission == typeFromResource);
    }

    const pipeEntitlements = redis.pipeline();
    let entitlements = {};
    for (const policy of policies) {
        for (const binding of policy.policy.bindings) {
            const role = Object.values(roles).find(obj => { return obj.name == binding.role });
            for (const member of binding.members) {
                for (const permission of role.includedPermissions) {
                    const service = serviceFromPermission(permission);
                    const entitlementId = `${permission}:${member}:${policy.resource}`;


                    if (!entitlements[entitlementId]) {
                        entitlements[entitlementId] = {
                            permission: permission,
                            service: service,
                            resource: policy.resource,
                            resourceDisplayName: normalizeResourceName(policy.resource),
                            member: member,
                            category: readPermissionCategory(permission),
                            attachmentScope: policy.resource.match(/\/\/cloudresourcemanager\.googleapis\.com\/projects\/.*/) ? 'project' : 'resource', //enum(org, folder, project, resource, multiple);
                            source: [{
                                type: 'direct', //TODO: enum('direct', 'linked', 'inherited')
                                role: binding.role,
                                attachmentPoint: policy.resource
                            }]
                        }
                        if (isOrgUnit(policy.resource) && (!matchesApi(permission, policy.resource))) {
                            entitlements[entitlementId].resourceDisplayName += "/*";
                        }
                    } else {
                        entitlements[entitlementId].source.push({
                            type: 'direct',
                            role: binding.role,
                            attachmentPoint: policy.resource
                        })
                    }
                }
            }
        }
        // save entitlements for policy and reset local variable
        for (const entId in entitlements) {
            const ent = entitlements[entId];
            pipeEntitlements.call('JSON.SET', `entitlements:${entId}`, '$', JSON.stringify(entitlements[entId]));
            pipeEntitlements.sadd('idx:identities', ent.member);
            pipeEntitlements.sadd(`idx:services:${ent.member}`, ent.service);
            pipeEntitlements.sadd(`idx:member:${ent.member}:service:${ent.service}`, entId);
        }
        pipeEntitlements.exec();
        entitlements = {};
    }
}


function normalizeService(serviceName) {
    if (serviceName.split('.')[1] == 'googleapis') {
        return serviceName.split('.')[0];
    } else {
        return serviceName;
    }
}

function normalizeResourceName(resourceName) {
    const splitName = resourceName.split('/');
    if (splitName[splitName.length - 2] == 'serviceAccounts') {
        return splitName[splitName.length - 1];
    }
    return trimApiFromResourceName(resourceName) ?? resourceName;
}

/************************************/

// Getters

function getIdentities() {
    return redis.smembers('idx:identities');
}


function getServices(identity) {
    //TODO: add services list from resources
    return redis.smembers(`idx:services:${identity}`);
}

async function getEntitlements(member, service) {
    function enrichEntitlement(ent) {
        return {
            ...ent,
            sourceCount: ent.source.length
        };
    }
    const ids = await redis.smembers(`idx:member:${member}:service:${service}`);
    if (ids.length === 0) return [];
    const pipeline = redis.pipeline();
    ids.forEach(id => pipeline.call('JSON.GET', `entitlements:${id}`));
    const results = await pipeline.exec();
    return results
        .filter(([err, val]) => !err && val)
        .map(([, val]) => JSON.parse(val))
        .map(enrichEntitlement);
}

/******************************** */
//const searchBase = 'organizations/81969898909'; 
const searchBase = 'projects/security-demo-40net'

const loadResourcesPromise = loadResources(searchBase)
    .then((resourcesFromApi) => {
        console.log(`Collected ${resourcesFromApi.length} resources from @google-cloud/asset.v1.AssetServiceClient().listAssets()`);
        return resourcesFromApi;
    })


const loadRolesPromise = loadRoles(searchBase)
    .then((rolesAll) => {
        console.log(`Collected ${Object.keys(rolesAll).length} roles from googleapis.iam.roles.list()`);
        return rolesAll;
    })


const loadPoliciesPromise = loadPolicies(searchBase)
    .then((policiesFromApi) => {
        console.log(`Collected ${policiesFromApi.length} policies from @google-cloud/asset.v1.AssetServiceClient().searchAllIamPolicies()`);
        return policiesFromApi;
    })


Promise.all([loadResourcesPromise, loadRolesPromise, loadPoliciesPromise])
    .then(async ([resourcesFromApi, roles, policiesFromApi]) => {
        console.log('all done. Loaded:');
        console.log(` - ${policiesFromApi.length} policies`);
        console.log(` - ${resourcesFromApi.length} resources`);
        console.log(` - ${Object.keys(roles).length} roles`);

        await policiesToEntitlements(policiesFromApi, roles);

        /*
        const identities = await getIdentities()
        //console.log(identities);
        const services = await getServices('user:bamo@gcp.40net.cloud');
        //console.log(services);
        getEntitlements('user:bamo@gcp.40net.cloud', 'iam')
            .then((res) => {
                //console.log(res);
                return 1;
            })
                */
    });


