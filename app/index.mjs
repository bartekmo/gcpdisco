import { google } from 'googleapis';
import { v1, v1p1beta1 } from '@google-cloud/asset';

const assetClientv1 = new v1.AssetServiceClient();
const assetClientv1p1beta1 = new v1p1beta1.AssetServiceClient();


var resourcesProcessed = [];
var policiesProcessed = [];

function getResources(parent) {
    return new Promise((resolve, reject) => {
        assetClientv1.listAssets({
            parent: parent,
            contentType: 'RESOURCE',
        }, (err, res) => {
            if (err) {
                reject(err);
            } else {
                resolve(res);
            }
        });
    });
}

function getPolicies(parent) {
    return new Promise((resolve, reject) => {
        assetClientv1p1beta1.searchAllIamPolicies({
            scope: parent,
        }, (err, res) => {
            if (err) {
                reject(err);
            } else {
                resolve(res);
            }
        });
    });
}

function getRoles(parent) {
    return new Promise((resolve, reject) => {
        google.auth.getClient({
            scopes: ['https://www.googleapis.com/auth/cloud-platform']
        }).then((authClient) => {
            //console.log(`auth OK ${JSON.stringify(authClient)}`);
            const googleIam = google.iam({ version: 'v1', auth: authClient });
            var rolesProcessed = {};
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
                });
            });

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
                resolve(rolesProcessed);
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
}


function preprocessPolicies(policies) {
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
}

/************************************/



const promiseResources = getResources('projects/security-demo-40net');
/*    .then((resourcesFromApi) => {
        preprocessResources(resourcesFromApi);
        console.log(JSON.stringify(resourcesProcessed, null, 4));
    })
    .catch((err) => {
        console.error(err);
    });
*/

getRoles()
    .then((rolesAll) => {
        for (let name in rolesAll) {
            console.log(name);
        }
        //console.log(JSON.stringify(rolesFromApi, null, 4));
    })
    .catch((err) => {
        console.error(err);
        console.error("dupa");
    });

/*
getPolicies('projects/security-demo-40net')
.then((policiesFromApi) => {
    preprocessPolicies(policiesFromApi);
    //console.log(JSON.stringify(policiesProcessed, null, 4));
})
.catch((err) => {
    console.error(err);
});

*/