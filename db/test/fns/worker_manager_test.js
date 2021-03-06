const _ = require('lodash');
const assert = require('assert').strict;
const helper = require('../helper');
const testing = require('taskcluster-lib-testing');
const { fromNow } = require('taskcluster-client');

suite(testing.suiteName(), function() {
  helper.withDbForProcs({ serviceName: 'worker_manager' });

  setup('reset table', async function() {
    await helper.withDbClient(async client => {
      await client.query('delete from worker_pools');
      await client.query('delete from workers');
    });
    helper.fakeDb.worker_manager.reset();
  });

  // worker-manager entities functions are tested by entities_test.js and by the worker-manager service tests

  const create_worker_pool = async (db, wp = {}) => {
    await db.fns.create_worker_pool(
      wp.worker_pool_id || 'wp/id',
      wp.provider_id || 'provider',
      wp.previous_provider_ids || '[]', // N.B. JSON-encoded
      wp.description || 'descr',
      wp.config || {config: true},
      wp.created || new Date(),
      wp.last_modified || new Date(),
      wp.owner || 'me@me.com',
      wp.email_on_error || false,
      wp.provider_data || {providerdata: true},
    );
  };
  const update_worker_pool = async (db, wp = {}) => {
    return await db.fns.update_worker_pool(
      wp.worker_pool_id || 'wp/id',
      wp.provider_id || 'provider',
      wp.description || 'descr',
      wp.config || {config: true},
      wp.last_modified || new Date(),
      wp.owner || 'me@me.com',
      wp.email_on_error || false,
    );
  };
  const create_worker = async (db, w = {}) => {
    return (await db.fns.create_worker(
      w.worker_pool_id || 'wp/id',
      w.worker_group || 'w/group',
      w.worker_id || 'w/id',
      w.provider_id || 'provider',
      w.created || new Date(),
      w.expires || new Date(),
      w.state || 'state',
      w.provider_data || {providerdata: true},
      w.capacity || 1,
      w.last_modified || new Date(),
      w.last_checked || new Date(),
    ))[0].create_worker;
  };
  const update_worker = async (db, w = {}, etag) => {
    return await db.fns.update_worker(
      w.worker_pool_id || 'wp/id',
      w.worker_group || 'w/group',
      w.worker_id || 'w/id',
      w.provider_id || 'provider',
      w.created || new Date(),
      w.expires || new Date(),
      w.state || 'state',
      w.provider_data || {providerdata: true},
      w.capacity || 1,
      w.last_modified || new Date(),
      w.last_checked || new Date(),
      etag,
    );
  };

  suite(`${testing.suiteName()} - worker_pools`, function() {
    helper.dbTest('create_worker_pool/get_worker_pool', async function(db, isFake) {
      const now = new Date();
      await create_worker_pool(db, {created: now, last_modified: now});

      const rows = await db.fns.get_worker_pool('wp/id');
      assert.equal(rows[0].worker_pool_id, 'wp/id');
      assert.equal(rows[0].provider_id, 'provider');
      assert.deepEqual(rows[0].previous_provider_ids, []);
      assert.equal(rows[0].description, 'descr');
      assert.deepEqual(rows[0].config, {config: true});
      assert.deepEqual(rows[0].created, now);
      assert.deepEqual(rows[0].last_modified, now);
      assert.equal(rows[0].owner, 'me@me.com');
      assert.equal(rows[0].email_on_error, false);
      assert.deepEqual(rows[0].provider_data, {providerdata: true});
    });

    helper.dbTest('get_worker_pool not found', async function(db, isFake) {
      const rows = await db.fns.get_worker_pool('wp/id');
      assert.deepEqual(rows, []);
    });

    helper.dbTest('get_worker_pools empty', async function(db, isFake) {
      const rows = await db.fns.get_worker_pools(null, null);
      assert.deepEqual(rows, []);
    });

    helper.dbTest('get_worker_pools full, pagination', async function(db, isFake) {
      for (let i = 0; i < 10; i++) {
        await create_worker_pool(db, {worker_pool_id: `wp/${i}`});
      }

      let rows = await db.fns.get_worker_pools(null, null);
      assert.deepEqual(rows.map(r => r.worker_pool_id), _.range(10).map(i => `wp/${i}`));
      assert.equal(rows[0].provider_id, 'provider');
      assert.deepEqual(rows[0].previous_provider_ids, []);
      assert.equal(rows[0].description, 'descr');
      assert.deepEqual(rows[0].config, {config: true});
      assert.equal(rows[0].owner, 'me@me.com');
      assert.equal(rows[0].email_on_error, false);
      assert.deepEqual(rows[0].provider_data, {providerdata: true});

      rows = await db.fns.get_worker_pools(2, 4);
      assert.deepEqual(rows.map(r => r.worker_pool_id), [4, 5].map(i => `wp/${i}`));
    });

    helper.dbTest('update_worker_pool, change to providerId', async function(db, isFake) {
      await create_worker_pool(db);
      const upd = await update_worker_pool(db, {provider_id: 'provider2'});
      assert.deepEqual(upd[0].previous_provider_id, 'provider');

      const rows = await db.fns.get_worker_pool('wp/id');
      assert.deepEqual(rows[0].previous_provider_ids, ['provider']);
    });

    helper.dbTest('update_worker_pool, change to providerId, new provider already in previous', async function(db, isFake) {
      await create_worker_pool(db, {previous_provider_ids: JSON.stringify(['provider2'])});
      const upd = await update_worker_pool(db, {provider_id: 'provider2'});
      assert.deepEqual(upd[0].previous_provider_id, 'provider');

      const rows = await db.fns.get_worker_pool('wp/id');
      assert.deepEqual(rows[0].previous_provider_ids, ['provider']);
    });

    helper.dbTest('update_worker_pool, change to providerId, old provider already in previous', async function(db, isFake) {
      await create_worker_pool(db, {previous_provider_ids: JSON.stringify(['provider'])});
      const upd = await update_worker_pool(db, {provider_id: 'provider2'});
      assert.deepEqual(upd[0].previous_provider_id, 'provider');

      const rows = await db.fns.get_worker_pool('wp/id');
      assert.deepEqual(rows[0].previous_provider_ids, ['provider']);
    });

    helper.dbTest('expire_worker_pool', async function(db, isFake) {
      await create_worker_pool(db, {
        worker_pool_id: 'done',
        provider_id: 'null-provider',
        previous_provider_ids: JSON.stringify([]),
      });
      await create_worker_pool(db, {
        worker_pool_id: 'still-running',
        provider_id: 'azure',
        previous_provider_ids: JSON.stringify([]),
      });
      await create_worker_pool(db, {
        worker_pool_id: 'hanger-on',
        provider_id: 'null-provider',
        previous_provider_ids: JSON.stringify(['google']),
      });

      const rows = await db.fns.expire_worker_pools();
      assert.deepEqual(rows.map(r => r.worker_pool_id), ['done']);
    });

    helper.dbTest('delete_worker_pool', async function(db, isFake) {
      await create_worker_pool(db);

      await db.fns.delete_worker_pool('wp/id');

      const rows = await db.fns.get_worker_pool('wp/id');
      assert.deepEqual(rows, []);
    });

    helper.dbTest('remove_worker_pool_previous_provider_id', async function(db, isFake) {
      await create_worker_pool(db, {previous_provider_ids: JSON.stringify(['old1', 'old2'])});

      await db.fns.remove_worker_pool_previous_provider_id('wp/id', 'old1');

      const rows = await db.fns.get_worker_pool('wp/id');
      assert.deepEqual(rows[0].previous_provider_ids, ['old2']);
    });

    helper.dbTest('remove_worker_pool_previous_provider_id, no worker-pool', async function(db, isFake) {
      await db.fns.remove_worker_pool_previous_provider_id('wp/id', 'old1');

      const rows = await db.fns.get_worker_pool('wp/id');
      assert.deepEqual(rows, []);
    });

    helper.dbTest('remove_worker_pool_previous_provider_id, no such provider', async function(db, isFake) {
      await create_worker_pool(db, {previous_provider_ids: JSON.stringify(['old1', 'old2'])});

      await db.fns.remove_worker_pool_previous_provider_id('wp/id', 'unknown');

      const rows = await db.fns.get_worker_pool('wp/id');
      assert.deepEqual(rows[0].previous_provider_ids, ['old1', 'old2']);
    });

    helper.dbTest('update_worker_pool_provider_data', async function(db, isFake) {
      await create_worker_pool(db, {provider_data: {someprov: {somedata: true}}});

      await db.fns.update_worker_pool_provider_data('wp/id', 'another', {moredata: true});

      const rows = await db.fns.get_worker_pool('wp/id');
      assert.deepEqual(rows[0].provider_data, {
        someprov: {somedata: true},
        another: {moredata: true},
      });
    });
  });

  suite(`${testing.suiteName()} - workers`, function() {
    helper.dbTest('create_worker/get_worker', async function(db, isFake) {
      const now = new Date();
      await create_worker(db, {created: now, last_modified: now, last_checked: now, expires: now});

      const rows = await db.fns.get_worker('wp/id', 'w/group', 'w/id');
      assert.equal(rows[0].worker_pool_id, 'wp/id');
      assert.equal(rows[0].worker_group, 'w/group');
      assert.equal(rows[0].worker_id, 'w/id');
      assert.equal(rows[0].provider_id, 'provider');
      assert.deepEqual(rows[0].created, now);
      assert.deepEqual(rows[0].expires, now);
      assert.equal(rows[0].state, 'state');
      assert.deepEqual(rows[0].provider_data, {providerdata: true});
      assert.equal(rows[0].capacity, 1);
      assert.deepEqual(rows[0].last_modified, now);
      assert.deepEqual(rows[0].last_checked, now);
    });

    helper.dbTest('get_worker not found', async function(db, isFake) {
      const rows = await db.fns.get_worker('wp/id', 'w/group', 'w/id');
      assert.deepEqual(rows, []);
    });

    helper.dbTest('get_workers empty', async function(db, isFake) {
      const rows = await db.fns.get_workers(null, null, null, null, null, null);
      assert.deepEqual(rows, []);
    });

    helper.dbTest('get_workers full, pagination', async function(db, isFake) {
      const now = new Date();
      for (let i = 0; i < 10; i++) {
        await create_worker(db, {
          worker_pool_id: `wp/${i}`,
          worker_group: `w/group${i}`,
          worker_id: `w/id${i}`,
          created: now,
          last_modified: now,
          last_checked: now,
          expires: now,
        });
      }

      let rows = await db.fns.get_workers(null, null, null, null, null, null);
      assert.deepEqual(
        rows.map(r => ({ worker_pool_id: r.worker_pool_id, worker_group: r.worker_group, worker_id: r.worker_id })),
        _.range(10).map(i => ({ worker_pool_id: `wp/${i}`, worker_group: `w/group${i}`, worker_id: `w/id${i}` })));
      assert.equal(rows[0].provider_id, 'provider');
      assert.deepEqual(rows[0].created, now);
      assert.deepEqual(rows[0].expires, now);
      assert.equal(rows[0].state, 'state');
      assert.deepEqual(rows[0].provider_data, {providerdata: true});
      assert.equal(rows[0].capacity, 1);
      assert.deepEqual(rows[0].last_modified, now);
      assert.deepEqual(rows[0].last_checked, now);

      rows = await db.fns.get_workers(null, null, null, null, 2, 4);
      assert.deepEqual(
        rows.map(r => ({ worker_pool_id: r.worker_pool_id, worker_group: r.worker_group, worker_id: r.worker_id })),
        [4, 5].map(i => ({ worker_pool_id: `wp/${i}`, worker_group: `w/group${i}`, worker_id: `w/id${i}` })));
    });

    helper.dbTest('expire_workers', async function(db, isFake) {
      await create_worker(db, { worker_pool_id: 'done', provider_id: 'null-provider', expires: fromNow('- 1 day') });
      await create_worker(db, { worker_pool_id: 'also-done', expires: fromNow('- 2 days') });
      await create_worker(db, { worker_pool_id: 'still-running', expires: fromNow('1 day') });

      const count = (await db.fns.expire_workers(fromNow()))[0].expire_workers;
      assert.equal(count, 2);
      const rows = await db.fns.get_workers(null, null, null, null, null, null);
      assert.equal(rows.length, 1);
    });

    helper.dbTest('update_worker, change to a single field', async function(db, isFake) {
      const etag = await create_worker(db);
      await db.fns.update_worker(
        'wp/id',
        'w/group',
        'w/id',
        'provider2',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        etag,
      );

      const rows = await db.fns.get_worker('wp/id', 'w/group', 'w/id');
      assert.equal(rows[0].worker_pool_id, 'wp/id');
      assert.equal(rows[0].worker_group, 'w/group');
      assert.equal(rows[0].worker_id, 'w/id');
      assert.equal(rows[0].provider_id, 'provider2');
      assert(rows[0].created instanceof Date);
      assert(rows[0].expires instanceof Date);
      assert.equal(rows[0].state, 'state');
      assert.deepEqual(rows[0].provider_data, { providerdata: true });
      assert.equal(rows[0].capacity, 1);
      assert(rows[0].last_modified instanceof Date);
      assert(rows[0].last_checked instanceof Date);
    });

    helper.dbTest('update_worker, change to a multiple fields', async function(db, isFake) {
      const etag = await create_worker(db);
      const updated = await db.fns.update_worker(
        'wp/id',
        'w/group',
        'w/id',
        'provider2',
        null,
        null,
        'requested',
        null,
        null,
        null,
        null,
        etag,
      );

      const rows = await db.fns.get_worker('wp/id', 'w/group', 'w/id');
      assert.equal(rows[0].provider_id, 'provider2');
      assert.equal(rows[0].state, 'requested');
      assert.deepEqual(updated, rows);
    });

    helper.dbTest('update_worker, no changes', async function(db, isFake) {
      const etag = await create_worker(db);
      const updated = await db.fns.update_worker(
        'wp/id',
        'w/group',
        'w/id',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        etag,
      );
      // this is not 0 because there was a row that matched even though there was no change
      assert.equal(updated.length, 1);

      const rows = await db.fns.get_worker('wp/id', 'w/group', 'w/id');
      assert.equal(rows[0].provider_id, 'provider');
      assert.equal(rows[0].state, 'state');
    });

    helper.dbTest('update_worker, worker doesn\'t exist', async function(db, isFake) {
      const etag = await create_worker(db);

      await assert.rejects(
        async () => {
          await update_worker(db, { worker_pool_id: 'does-not-exist' }, etag);
        },
        /no such row/,
      );
    });

    helper.dbTest('update_worker, override when etag not specified', async function(db, isFake) {
      await create_worker(db);
      await db.fns.update_worker(
        'wp/id',
        'w/group',
        'w/id',
        null,
        null,
        null,
        null,
        null,
        2, /* capacity */
        null,
        null,
        null, /* etag */
      );

      const rows = await db.fns.get_worker('wp/id', 'w/group', 'w/id');
      assert.equal(rows[0].capacity, 2);
    });

    helper.dbTest('update_worker, throws when etag is wrong', async function(db, isFake) {
      await create_worker(db);
      await assert.rejects(
        async () => {
          await db.fns.update_worker(
            'wp/id',
            'w/group',
            'w/id',
            null,
            null,
            null,
            null,
            null,
            2, /* capacity */
            null,
            null,
            '915a609a-f3bb-42fa-b584-a1209e7d9a02', /* etag */
          );
        },
        /unsuccessful update/,
      );
    });

    helper.dbTest('update_worker, throws when row does not exist', async function(db, isFake) {
      const etag = await create_worker(db);
      await assert.rejects(
        async () => {
          await db.fns.update_worker(
            'does-not-exist',
            'w/group',
            'w/id',
            null,
            null,
            null,
            null,
            null,
            2, /* capacity */
            null,
            null,
            etag,
          );
        },
        /no such row/,
      );
    });

    helper.dbTest('delete_worker', async function(db, isFake) {
      await create_worker_pool(db);

      await db.fns.delete_worker('wp/id', 'w/group', 'w/id');

      const rows = await db.fns.get_worker('wp/id', 'w/group', 'w/id');
      assert.deepEqual(rows, []);
    });
  });
});
