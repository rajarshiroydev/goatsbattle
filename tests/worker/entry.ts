export { LiveMatchCoordinator } from '../../src/durable/LiveMatchCoordinator';
export { StatsApiRequestBroker } from '../../src/durable/StatsApiRequestBroker';

export default {
  fetch(): Response {
    return new Response('Not found', { status: 404 });
  },
};
