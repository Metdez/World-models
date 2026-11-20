import { DurableObject } from 'cloudflare:workers';

/** STUB — owner: plan 06-01. Durable Object for rooms (presence, presenter remote, poll). */
export class Room extends DurableObject<Env> {
  override async fetch(): Promise<Response> {
    return new Response('not implemented', { status: 501 });
  }
}
