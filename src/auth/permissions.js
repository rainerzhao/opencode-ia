'use strict';

function isActiveUser(user) {
  return Boolean(
    user &&
    typeof user.id === 'string' &&
    user.id !== '' &&
    (user.role === 'admin' || user.role === 'member') &&
    user.status === 'active'
  );
}

function isResource(resource) {
  return Boolean(
    resource &&
    typeof resource.ownerUserId === 'string' &&
    resource.ownerUserId !== '' &&
    (resource.visibility === 'private' || resource.visibility === 'shared')
  );
}

function can(user, action, resource) {
  if (!isActiveUser(user)) return false;

  switch (action) {
    case 'workbench:use':
      return true;
    case 'sessions:list':
      return user.role === 'admin';
    case 'resource:read':
      return isResource(resource) && (
        resource.visibility === 'shared' ||
        resource.ownerUserId === user.id ||
        user.role === 'admin'
      );
    case 'resource:write':
      return isResource(resource) && (
        resource.ownerUserId === user.id ||
        user.role === 'admin'
      );
    case 'resource:manage':
    case 'resource:delete-permanently':
      return isResource(resource) && user.role === 'admin';
    default:
      return false;
  }
}

module.exports = { can, isActiveUser };
