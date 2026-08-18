import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /** Root payload: enough to tell what this service is and where the docs are. */
  getInfo() {
    return {
      name: 'Roommate Match API',
      status: 'ok',
      docs: '/api/docs',
      health: '/health',
    };
  }
}
