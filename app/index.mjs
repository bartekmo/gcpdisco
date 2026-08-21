import { google } from 'googleapis';
import { v1, v1p1beta1 } from '@google-cloud/asset';
import Keyv from 'keyv';

const assetClientv1 = new v1.AssetServiceClient();
//const assetClientv1p1beta1 = new v1p1beta1.AssetServiceClient();

const store = new Keyv();

function getResources(parent) {
    return new Promise((resolve, reject) => {
        assetClientv1.listAssets({
            parent: parent,
            contentType: 'RESOURCE',
        }, (err, res) => {
            if (err) {
                reject(err);
            } else {
                let resourcesProcessed = preprocessResources(res);
                Promise.all([store.set('resources', resourcesProcessed), store.set('resourceNames', Object.keys(resourcesProcessed))])
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

function getPolicies(parent) {
    return new Promise((resolve, reject) => {
        assetClientv1.searchAllIamPolicies({
            scope: parent,
        }, (err, res) => {
            if (err) {
                reject(err);
            } else {
                let policiesProcessed = preprocessPolicies(res);
                Promise.all([store.set('policies', policiesProcessed), store.set('policyIds', Object.keys(policiesProcessed))])
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

function getRoles(parent) {
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
                Promise.all([store.set('roles', rolesProcessed), store.set('roleNames', Object.keys(rolesProcessed))])
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


    let resourcesProcessed = {};
    resources.forEach((resource) => {
        if (!notResources.includes(resource.assetType) &&
            (!skipSubResources || resource.resource.parent.split('/').length <= 5)) {
            resourcesProcessed[resource.name] = {
                name: resource.name,
                displayName: formatResourceName(resource),
                type: resource.assetType,
                parent: trimApiFromResourceName(resource.resource.parent) ?? resource.resource.parent
            };
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

async function processPoliciesToPermissions() {
    const roles = await store.get('roles');
    const policies = await store.get('policies');
    let policiesExpanded = [];

    policies.forEach((policy) => {
        console.log(roles[policy.role]);
        roles[policy.role].includedPermissions.forEach((permission) => {
            policiesExpanded.push({
                attachmentPoint: policy.resource,
                role: binding.role,
                member: member,
                condition: binding.condition,
                permission: permission
            });
        }); //for each permission in role
    }); //for each policy
    return store.set('policiesExpanded', policiesExpanded);
}

/************************************/

// Getters

function getServices() { }

/******************************** */


const loadResources = getResources('projects/security-demo-40net')
    .then((resourcesFromApi) => {
        console.log(`Collected ${resourcesFromApi.length} resources`);
    })
    .catch((err) => {
        console.error(err);
    });


const loadRoles = getRoles('projects/security-demo-40net')
    .then((rolesAll) => {
        console.log(`Collected ${Object.keys(rolesAll).length} roles`);
    })
    .catch((err) => {
        console.error(err);
    });


const loadPolicies = getPolicies('projects/security-demo-40net')
    .then((policiesFromApi) => {
        console.log(`Collected ${policiesFromApi.length} policies`);
    })
    .catch((err) => {
        console.error(err);
    });

Promise.all([loadResources, loadRoles, loadPolicies]).then(() => {
    console.log('all done');
    store.get('resourceNames').then((resources) => {
        console.log(`resources from store: ${resources.length}`);
    });
    store.get('roleNames').then((roles) => {
        console.log(`roles from store: ${roles.length}`);
    });
    store.get('policies').then((policies) => {
        console.log(`policies from store: ${policies.length}`);
        //console.log(policies);
    });

    processPoliciesToPermissions()
        .then(() => {
            store.get('policiesExpanded').then((policiesExpanded) => {
                console.log(`policiesExpanded from store: ${policiesExpanded.length}`);
            });
        })
});


