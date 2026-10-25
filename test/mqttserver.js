const aedes = require('aedes')();
const { WebSocketServer, createWebSocketStream } = require('ws');
const wss = new WebSocketServer({ host: '127.0.0.1', port: Number(process.argv[2] || 9001), handleProtocols: p => p.has('mqtt') ? 'mqtt' : false });
wss.on('connection', ws => aedes.handle(createWebSocketStream(ws)));
wss.on('listening', () => console.log('mqtt up', wss.address().port));
