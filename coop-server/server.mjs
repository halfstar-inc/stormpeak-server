import http from 'node:http';
import { randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const heroes = new Set(['wizard', 'archer', 'barbarian']);
export function createLobby({ roomLifetime = 7200000, maxRooms = 500 } = {}) {
  const rooms = new Map();
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url === '/health' ? { ok: true, service: 'stormpeak-lobby' } : { error: 'Not found' }));
  });
  const wss = new WebSocketServer({ server, maxPayload: 262144, perMessageDeflate: false });
  const send = (socket, value) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
  const error = (socket, message) => send(socket, { type: 'error', message });
  const broadcast = room => room.members.forEach(socket => send(socket, {
    type: 'room', code: room.code, slot: room.members.indexOf(socket), phase: room.phase,
    players: room.members.map((p, slot) => ({ slot, character: p.character }))
  }));
  const emit = (room, value) => room.members.forEach(socket => send(socket, value));
  const state = room => emit(room, { type: 'session', phase: room.phase, epoch: room.epoch,
    level: room.level, wave: room.wave, votes: room.votes, perches: room.perches,
    ready: room.ready, blessings: room.blessings });
  function sessionMessage(socket, message) {
    const room = socket.room;
    if (!room || room.members.length !== 2) { error(socket, 'Both players must be connected.'); return; }
    const slot = room.members.indexOf(socket);
    if (message.type === 'enter') {
      if (!['lobby', 'results', 'defeat', 'map'].includes(room.phase) || !['map', 'guild'].includes(message.destination)) return;
      if (room.phase === 'map' && message.destination !== 'guild') return;
      room.phase = message.destination; room.ready = [false, false]; room.votes = [null, null]; state(room); return;
    }
    if (message.epoch !== room.epoch) return;
    switch (message.type) {
      case 'team_defeat':
        if (slot !== 0 || room.phase !== 'combat') return;
        room.phase = 'defeat'; state(room); break;
      case 'vote': {
        if (room.phase !== 'map' || !Number.isInteger(message.level) || message.level < 0 || message.level > 9) return;
        room.votes[slot] = message.level;
        if (room.votes.every(v => v !== null)) {
          room.level = room.votes[randomInt(2)]; room.wave = 1; room.epoch++;
          room.phase = 'loading'; room.ready = [false, false]; room.perches = [2, 1]; room.blessings = [{}, {}];
        }
        state(room); break;
      }
      case 'loaded':
        if (room.phase !== 'loading') return;
        room.ready[slot] = true;
        if (room.ready.every(Boolean)) { room.phase = 'combat'; room.ready = [false, false]; }
        state(room); break;
      case 'teleport': {
        if (room.phase !== 'combat' || !Number.isInteger(message.perch) || message.perch < 0 || message.perch > 4) return;
        const now = Date.now();
        const allowed = message.perch !== room.perches[slot] && message.perch !== room.perches[1-slot] && now - (socket.lastTeleport || 0) >= 250;
        if (allowed) { room.perches[slot] = message.perch; socket.lastTeleport = now; }
        emit(room, { type: 'teleport_result', epoch: room.epoch, slot, allowed, perch: room.perches[slot] });
        break;
      }
      case 'wave_clear':
        if (slot !== 0 || room.phase !== 'combat' || message.wave !== room.wave) return;
        room.ready = [false, false];
        if (room.wave === 5) room.phase = 'results';
        else if ([1, 2, 3, 4].includes(room.wave)) room.phase = 'reward';
        else { room.wave++; room.phase = 'loading'; }
        state(room); break;
      case 'blessing': {
        const caps = { power: 3, flow: 3, guard: 3, blink: 3, precision: 1, echo: 3 };
        for (const id of ['force','fire','chromatic','frost','vines','acid','radiant','storm','void']) caps[`mod_${id}`] = 1;
        if ((room.wave === 1) !== String(message.id).startsWith('mod_')) return;
        if (room.phase !== 'reward' || room.ready[slot] || !Object.hasOwn(caps, message.id)) return;
        const owned = room.blessings[slot];
        if ((owned[message.id] || 0) >= caps[message.id]) return;
        owned[message.id] = (owned[message.id] || 0) + 1; room.ready[slot] = true;
        if (room.ready.every(Boolean)) { room.wave++; room.phase = 'loading'; room.ready = [false, false]; }
        state(room); break;
      }
      case 'guild_ready':
        if (room.phase !== 'guild' || typeof message.ready !== 'boolean') return;
        room.ready[slot] = message.ready;
        if (room.ready.every(Boolean)) { room.phase = 'map'; room.ready = [false, false]; room.votes = [null, null]; }
        state(room); break;
      case 'player':
        if (!['guild', 'combat'].includes(room.phase)) return;
        if (!Array.isArray(message.position) || message.position.length !== 2 || !message.position.every(n => Number.isFinite(n) && Math.abs(n) < 10000)) return;
        if (!heroes.has(message.character)) return;
        if (room.phase === 'combat' && message.character === 'barbarian' && Number.isInteger(message.walk_perch) && message.walk_perch >= 0 && message.walk_perch < 5 && room.perches[1-slot] !== message.walk_perch) room.perches[slot] = message.walk_perch;
        send(room.members[1-slot], { type: 'player', epoch: room.epoch, slot, position: message.position, character: message.character,
          hp: Math.max(0, Math.min(100000, Number(message.hp) || 0)), perches: room.perches, art: message.art || {}, animation: String(message.animation || 'idle').slice(0,32) }); break;
      case 'world':
        if (slot !== 0 || room.phase !== 'combat' || message.data?.wave !== room.wave) return;
        if (room.members[1].bufferedAmount > 524288) return;
        send(room.members[1], { type: 'world', epoch: room.epoch, data: message.data }); break;
      case 'action':
        if (room.phase !== 'combat' || message.wave !== room.wave || !Number.isSafeInteger(message.sequence) || message.sequence <= (socket.sequence || 0)) return;
        socket.sequence = message.sequence;
        send(room.members[1-slot], { type: 'action', epoch: room.epoch, wave: room.wave, slot, sequence: message.sequence, data: message.data }); break;
    }
  }
  function closeRoom(room) {
    rooms.delete(room.code);
    room.members.forEach(socket => { socket.room = null; send(socket, { type: 'room_closed' }); });
  }
  wss.on('connection', socket => {
    if (wss.clients.size > maxRooms * 3) { socket.close(1013, 'Lobby busy'); return; }
    socket.alive = true; socket.attempts = 0; socket.windowStart = Date.now(); socket.connectedAt = Date.now();
    socket.on('pong', () => { socket.alive = true; });
    socket.on('error', () => {});
    socket.on('message', raw => {
      if (Date.now() - socket.windowStart > 1000) { socket.attempts = 0; socket.windowStart = Date.now(); }
      if (++socket.attempts > (socket.room ? 100 : 5)) { socket.close(1008, 'Too many requests'); return; }
      let message;
      try { message = JSON.parse(raw.toString()); } catch { error(socket, 'Invalid request.'); return; }
      if (!message || typeof message !== 'object') { error(socket, 'Unsupported request.'); return; }
      if (!['host', 'join'].includes(message.type)) { sessionMessage(socket, message); return; }
      if (socket.room) { error(socket, 'Leave your current room first.'); return; }
      socket.character = heroes.has(message.character) ? message.character : 'wizard';
      if (message.type === 'host') {
        if (rooms.size >= maxRooms) { error(socket, 'The lobby is busy. Please try again shortly.'); return; }
        let code;
        do { code = Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (rooms.has(code));
        const room = { code, members: [socket], expires: Date.now() + roomLifetime, phase: 'lobby', epoch: 0,
          level: 0, wave: 1, votes: [null,null], perches: [2,1], ready: [false,false], blessings: [{},{}] };
        rooms.set(code, room); socket.room = room; broadcast(room);
      } else {
        const code = typeof message.code === 'string' ? message.code.toUpperCase() : '';
        const room = rooms.get(code);
        if (!room || room.expires <= Date.now()) { error(socket, 'Room not found or expired. Ask your friend for a new invite.'); return; }
        if (room.members.length >= 2) { error(socket, 'This room already has two players.'); return; }
        room.members.push(socket); socket.room = room; broadcast(room);
      }
    });
    socket.on('close', () => {
      const room = socket.room;
      if (!room) return;
      if (room.members[0] === socket) closeRoom(room);
      else { closeRoom(room); }
    });
  });
  const timer = setInterval(() => {
    for (const room of rooms.values()) if (room.expires <= Date.now()) closeRoom(room);
    for (const socket of wss.clients) {
      if (!socket.alive || (!socket.room && Date.now() - socket.connectedAt > 60000)) { socket.terminate(); continue; }
      socket.alive = false; socket.ping();
    }
  }, 30000);
  timer.unref();
  return { server, rooms, close: async () => {
    clearInterval(timer); for (const socket of wss.clients) socket.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lobby = createLobby();
  lobby.server.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => console.log('Stormpeak lobby listening'));
  process.on('SIGTERM', async () => { await lobby.close(); process.exit(0); });
}
