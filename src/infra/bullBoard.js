/**
 * Bull Board — Web UI for monitoring BullMQ queues
 * Mounted at /admin/queues, protected by requireAuth
 */

const { createBullBoard } = require('@bull-board/api');
const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');
const { ExpressAdapter } = require('@bull-board/express');
const { getTintimQueue, getKommoQueue } = require('./queues');

function setupBullBoard(app, requireAuth) {
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');

    createBullBoard({
        queues: [
            new BullMQAdapter(getTintimQueue()),
            new BullMQAdapter(getKommoQueue()),
        ],
        serverAdapter,
    });

    app.use('/admin/queues', requireAuth, serverAdapter.getRouter());
}

module.exports = { setupBullBoard };
