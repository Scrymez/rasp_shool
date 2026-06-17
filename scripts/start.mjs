process.env.NODE_ENV = 'production';
const { startServer } = await import('../server/index.js');

startServer();
