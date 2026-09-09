import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createLobby } from './server.mjs';

test('two-player session coordinates votes, occupied circles, rewards and guild exit', async () => {
  const lobby = createLobby();
  lobby.server.listen(0, '127.0.0.1'); await once(lobby.server, 'listening');
  const url = `ws://127.0.0.1:${lobby.server.address().port}`;
  const connect = async () => {
    const ws = new WebSocket(url); await once(ws, 'open');
    const queue = []; const waiters = [];
    ws.on('message', raw => {
      const value = JSON.parse(raw.toString());
      const i = waiters.findIndex(w => w.type === value.type);
      if (i >= 0) waiters.splice(i,1)[0].resolve(value); else queue.push(value);
    });
    return { ws, send: value => ws.send(JSON.stringify(value)), next: type => {
      const i = queue.findIndex(v => v.type === type);
      if (i >= 0) return Promise.resolve(queue.splice(i,1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Missing ${type}`)), 2000);
        waiters.push({ type, resolve: value => { clearTimeout(timer); resolve(value); } });
      });
    }};
  };
  try {
    const host = await connect(); const guest = await connect();
    host.send({ type: 'host', character: 'wizard' }); const room = await host.next('room');
    guest.send({ type: 'join', code: room.code, character: 'barbarian' });
    assert.equal((await host.next('room')).slot, 0);
    assert.equal((await guest.next('room')).slot, 1);
    let epoch = 0;
    const command = async (peer, value) => {
      peer.send({ epoch, ...value });
      const a = await host.next('session'); const b = await guest.next('session');
      assert.deepEqual(a,b); epoch = a.epoch; return a;
    };
    assert.equal((await command(host,{type:'enter',destination:'guild'})).phase,'guild');
    assert.equal((await command(guest,{type:'guild_ready',ready:true})).phase,'guild');
    assert.equal((await command(guest,{type:'guild_ready',ready:false})).ready[1],false);
    await command(host,{type:'guild_ready',ready:true});
    assert.equal((await command(guest,{type:'guild_ready',ready:true})).phase,'map');
    assert.equal((await command(host,{type:'vote',level:2})).phase,'map');
    const choice=await command(guest,{type:'vote',level:7});
    assert.ok([2,7].includes(choice.level)); assert.equal(choice.phase,'loading');
    assert.deepEqual(choice.perches,[2,1]);
    assert.equal((await command(host,{type:'loaded'})).phase,'loading');
    assert.equal((await command(guest,{type:'loaded'})).phase,'combat');
    host.send({type:'teleport',epoch,perch:1});
    assert.equal((await host.next('teleport_result')).allowed,false); await guest.next('teleport_result');
    host.send({type:'teleport',epoch,perch:4});
    assert.equal((await host.next('teleport_result')).allowed,true); await guest.next('teleport_result');
    guest.send({type:'teleport',epoch,perch:4});
    assert.equal((await guest.next('teleport_result')).allowed,false); await host.next('teleport_result');
    // A guest cannot finish the wave; a stale host packet cannot advance it either.
    guest.send({type:'wave_clear',epoch,wave:1}); host.send({type:'wave_clear',epoch:epoch-1,wave:1});
    assert.equal((await command(host,{type:'wave_clear',wave:1})).phase,'reward');
    host.send({type:'blessing',epoch,id:'power'}); // wave 1 is an infusion, not a blessing
    const infusion=await command(host,{type:'blessing',id:'mod_fire'});
    assert.equal(infusion.phase,'reward'); assert.equal(infusion.blessings[0].mod_fire,1);
    const infused=await command(guest,{type:'blessing',id:'mod_storm'});
    assert.equal(infused.phase,'loading'); assert.equal(infused.wave,2);
    for (let wave=2;wave<=4;wave++) {
      await command(host,{type:'loaded'}); await command(guest,{type:'loaded'});
      assert.equal((await command(host,{type:'wave_clear',wave})).phase,'reward');
      const first=await command(host,{type:'blessing',id:'power'});
      assert.equal(first.phase,'reward'); assert.equal(first.blessings[0].power,wave-1);
      host.send({type:'blessing',epoch,id:'power'}); // duplicate must not add another stack
      const both=await command(guest,{type:'blessing',id:'flow'});
      assert.equal(both.phase,'loading'); assert.equal(both.blessings[0].power,wave-1);
      assert.equal(both.blessings[1].flow,wave-1);
    }
    await command(host,{type:'loaded'}); await command(guest,{type:'loaded'});
    guest.send({type:'action',epoch,wave:5,sequence:1,data:{kind:'test'}});
    assert.equal((await host.next('action')).slot,1);
    assert.equal((await command(host,{type:'wave_clear',wave:5})).phase,'results');
    assert.equal((await command(guest,{type:'enter',destination:'guild'})).phase,'guild');
    const ended=host.next('room_closed'); guest.ws.close(); await ended;
    assert.equal(lobby.rooms.size,0);
  } finally { await lobby.close(); }
});
