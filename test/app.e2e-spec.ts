import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET) names the service and points at the docs', () => {
    return request(app.getHttpServer()).get('/').expect(200).expect({
      name: 'Roommate Match API',
      status: 'ok',
      docs: '/api/docs',
      health: '/health',
    });
  });

  it('/health (GET) reports the process is alive', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
  });

  it('/health/ready (GET) checks the database and object storage', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');

    expect([200, 503]).toContain(res.status);
    expect(res.body.checks).toHaveProperty('database');
    expect(res.body.checks).toHaveProperty('storage');
  });

  afterEach(async () => {
    await app.close();
  });
});
