'use strict';

function mysqlClientOptions(connection, sslCaFile) {
  return [
    '--protocol=TCP', '--host', connection.host, '--port', String(connection.port), '--user', connection.user,
    ...(connection.ssl ? ['--ssl-mode=VERIFY_IDENTITY', ...(sslCaFile ? [`--ssl-ca=${sslCaFile}`] : [])] : [])
  ];
}

module.exports = { mysqlClientOptions };
