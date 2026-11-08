/* Netlify Function "api": the Express app, served at /api/v1/* (see the _redirects rule in deploy_netlify.py). */
const serverless = require('serverless-http');
const { createApp } = require('../src/app');

const handler = serverless(createApp());

exports.handler = async (event, context) => {
  // Don't wait for idle database connections before answering.
  context.callbackWaitsForEmptyEventLoop = false;
  return handler(event, context);
};
