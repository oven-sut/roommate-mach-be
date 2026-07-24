import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';

describe('RegisterDto', () => {
  const validRegistration = {
    displayName: 'SUT Student',
    email: 'b6712345@g.sut.ac.th',
    password: 'password123',
  };

  it('accepts and normalizes the sutId sent by the mobile app', async () => {
    const dto = plainToInstance(RegisterDto, {
      ...validRegistration,
      sutId: ' B6712345 ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.sutId).toBe('b6712345');
  });

  it('keeps sutId optional for existing clients', async () => {
    const dto = plainToInstance(RegisterDto, validRegistration);

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects malformed SUT student IDs', async () => {
    const dto = plainToInstance(RegisterDto, {
      ...validRegistration,
      sutId: 'student-123',
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'sutId')).toBe(true);
  });
});
