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
                store.set('resources', preprocessResources(res))
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
                store.set('policies', preprocessPolicies(res))
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

            // get predefined roles from API
            const promiseRolesGlobal = googleIam.roles.list({
                "view": "FULL",
            }).then((res) => {
                res.data.roles.forEach((role) => {
                    rolesProcessed[role.name] = {
                        name: role.name,
                        title: role.title,
                        description: role.description,
                        stage: role.stage,
                        includedPermissions: role.includedPermissions
                    };
                }); //for each predefined role
            });

            //get custom roles from project/organization
            const promiseRolesProject = googleIam.roles.list({
                "parent": parent,
                "view": "FULL",
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
            });

            Promise.all([promiseRolesGlobal, promiseRolesProject]).then(() => {
                store.set('roles', rolesProcessed)
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



function preprocessResources(resources, skipSubResources = true) {
    const notResources = ['serviceusage.googleapis.com/Service'];
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

    let resourcesProcessed = [];
    resources.forEach((resource) => {
        if (!notResources.includes(resource.assetType) &&
            (!skipSubResources || resource.resource.parent.split('/').length <= 5)) {
            resourcesProcessed.push({
                name: resource.name,
                displayName: formatResourceName(resource),
                type: resource.assetType,
                parent: trimApiFromResourceName(resource.resource.parent) ?? resource.resource.parent
            });
        }
    });
    return resourcesProcessed;
}


function preprocessPolicies(policies) {
    let policiesProcessed = [];
    policies.forEach((policy) => {
        //        console.log(policy);
        policy.policy.bindings.forEach((binding) => {
            //            console.log(binding);
            binding.members.forEach((member) => {
                policiesProcessed.push({
                    attachmentPoint: policy.resource,
                    role: binding.role,
                    member: member,
                    condition: binding.condition
                });
            })
        })
    })
    return policiesProcessed;
}

/************************************/



const loadResources = getResources('projects/security-demo-40net')
    .then((resourcesFromApi) => {
        preprocessResources(resourcesFromApi);
        console.log(`Collected ${resourcesFromApi.length} resources`);
    })
    .catch((err) => {
        console.error(err);
    });


const loadRoles = getRoles()
    .then((rolesAll) => {
        console.log(`Collected ${Object.keys(rolesAll).length} roles`);
    })
    .catch((err) => {
        console.error(err);
    });


const loadPolicies = getPolicies('projects/security-demo-40net')
    .then((policiesFromApi) => {
        preprocessPolicies(policiesFromApi);
        console.log(`Collected ${policiesFromApi.length} policies`);
    })
    .catch((err) => {
        console.error(err);
    });

Promise.all([loadResources, loadRoles, loadPolicies]).then(() => {
    console.log('all done');
    store.get('resources').then((resources) => {
        console.log(`resources from store: ${resources.length}`);
    });
    store.get('roles').then((roles) => {
        console.log(`roles from store: ${roles.length}`);
    });
    store.get('policies').then((policies) => {
        console.log(`policies from store: ${policies.length}`);
    });


});
