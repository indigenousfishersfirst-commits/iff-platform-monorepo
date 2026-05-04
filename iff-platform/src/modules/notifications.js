// modules/notifications.js
// Slack + email + Durable Object broadcast for important events

export async function notifyAdmins(env, { title, body, severity = 'info', meta = {} }) {
  const payload = {
    title,
    body,
    severity,
    meta,
    timestamp: new Date().toISOString(),
    source: 'iff-platform'
  };

  // Persist to D1 notifications log
  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO notifications_log (title, body, severity, meta, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`
      ).bind(
        title,
        body,
        severity,
        JSON.stringify(meta),
        payload.timestamp
      ).run();
    } catch (e) {
      // Log table may not exist yet — non-fatal
      console.warn('notifications_log insert failed:', e.message);
    }
  }

  // Slack via webhook (optional)
  if (env.SLACK_WEBHOOK_URL) {
    const color = severity === 'critical' ? '#d73a49'
                : severity === 'warn'     ? '#f6a623'
                                           : '#0366d6';
    try {
      await fetch(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attachments: [{
            color,
            title: `[IFF] ${title}`,
            text: body,
            fields: Object.entries(meta).map(([k, v]) => ({
              title: k, value: String(v), short: true
            })),
            ts: Math.floor(Date.now() / 1000)
          }]
        })
      });
    } catch (e) {
      console.warn('slack notify failed:', e.message);
    }
  }

  return payload;
}

export async function notifyHarvester(env, harvesterId, { title, body, kind = 'info', lotId = null }) {
  const row = {
    user_id: harvesterId,
    title,
    body,
    kind,
    lot_id: lotId,
    read: 0,
    created_at: new Date().toISOString()
  };

  if (env.DB) {
    await env.DB.prepare(
      `INSERT INTO user_notifications (user_id, title, body, kind, lot_id, read, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    ).bind(row.user_id, row.title, row.body, row.kind, row.lot_id, row.read, row.created_at).run();
  }

  return row;
}

export async function broadcastSignalUpdate(env, signal) {
  // Push signal updates to all open auction Durable Objects
  // Auction DOs subscribe to signal changes for their species
  if (!env.AUCTION_ROOM) return;

  const key = `signals:broadcast:${signal.signal_id}`;
  await env.KV?.put(key, JSON.stringify({
    signal_id: signal.signal_id,
    value: signal.value,
    confidence: signal.confidence,
    direction: signal.direction,
    species: signal.species,
    updated_at: new Date().toISOString()
  }), { expirationTtl: 3600 });
}
