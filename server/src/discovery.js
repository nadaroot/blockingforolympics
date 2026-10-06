const dgram = require('dgram');

function startDiscoveryServer(serverPort = 3000, udpPort = 41234) {
  const socket = dgram.createSocket('udp4');

  socket.on('error', (err) => {
    console.error(`[UDP Discovery] Server error:`, err);
    try { socket.close(); } catch (_) {}
  });

  socket.on('message', (msg, rinfo) => {
    const message = msg.toString().trim();
    if (message === 'LOKED_DISCOVER') {
      const response = Buffer.from(`LOKED_SERVER:${serverPort}`);
      socket.send(response, 0, response.length, rinfo.port, rinfo.address, (err) => {
        if (!err) {
          console.log(`[UDP Discovery] Responded to client at ${rinfo.address}:${rinfo.port}`);
        }
      });
    }
  });

  socket.on('listening', () => {
    const address = socket.address();
    console.log(`[UDP Discovery] Listening for clients on port ${address.port}`);
  });

  try {
    socket.bind(udpPort);
  } catch (err) {
    console.error('[UDP Discovery] Failed to bind:', err);
  }

  return socket;
}

module.exports = { startDiscoveryServer };
