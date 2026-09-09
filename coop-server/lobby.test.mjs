import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createLobby } from './server.mjs';
test('invite joins two players; rejects full/unknown rooms; host departure expires invite', async () => {
  const lobby = createLobby();
  lobby.server.listen(0, '127.0.0.1'); await once(lobby.server, 'listening');
  const url = `ws://127.0.0.1:${lobby.server.address().port}`;
  const connect = async () => { const ws = new WebSocket(url); await once(ws, 'open'); return ws; };
  const request = async (ws, message) => { const reply = once(ws, 'message'); ws.send(JSON.stringify(message)); return JSON.parse((await reply)[0]); };
  try {
    const host = await connect();
    const room = await request(host, { type: 'host', character: 'wizard' });
    assert.match(room.code, /^[A-HJ-NP-Z2-9]{12}$/); assert.equal(room.players.length, 1);
    const guest = await connect();
    const joined = await request(guest, { type: 'join', code: room.code, character: 'archer' });
    assert.equal(joined.players.length, 2); assert.equal(joined.players[1].character, 'archer');
    const third = await connect();
    assert.equal((await request(third, { type: 'join', code: room.code })).type, 'error');
    assert.equal((await request(third, { type: 'join', code: 'AAAAAAAAAAAA' })).type, 'error');
    const closed = once(guest, 'message'); host.close();
    assert.equal(JSON.parse((await closed)[0]).type, 'room_closed');
    assert.equal((await request(third, { type: 'join', code: room.code })).type, 'error');
  } finally { await lobby.close(); }
});
