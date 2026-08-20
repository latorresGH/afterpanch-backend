import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../users/users.service';

/**
 * El JWT ya viene verificado (firma + exp) por passport-jwt cuando corre
 * validate(). Lo que se testea acá es el segundo chequeo: que el usuario del
 * token siga existiendo y activo, y que cualquier problema salga como 401.
 */
describe('JwtStrategy.validate', () => {
  let strategy: JwtStrategy;
  let usersService: { findByIdOrNull: jest.Mock; findOne: jest.Mock };

  const payload = { sub: 'user-id' };

  beforeEach(() => {
    process.env.JWT_SECRET = 'secreto-de-test';
    usersService = { findByIdOrNull: jest.fn(), findOne: jest.fn() };
    strategy = new JwtStrategy(usersService as unknown as UsersService);
  });

  it('devuelve el usuario normalizado si existe y está activo', async () => {
    usersService.findByIdOrNull.mockResolvedValue({
      id: 'user-id',
      role: 'ADMIN',
      email: 'admin@test.com',
      nombre: 'Admin',
      activo: true,
    });

    await expect(strategy.validate(payload)).resolves.toEqual({
      sub: 'user-id',
      role: 'ADMIN',
      email: 'admin@test.com',
      nombre: 'Admin',
    });
  });

  it('tira 401 (no 404) si el usuario fue borrado de la DB', async () => {
    usersService.findByIdOrNull.mockResolvedValue(null);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('tira 401 si el usuario está desactivado', async () => {
    usersService.findByIdOrNull.mockResolvedValue({
      id: 'user-id',
      role: 'ADMIN',
      email: 'admin@test.com',
      nombre: 'Admin',
      activo: false,
    });

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('no usa findOne, que tiraría NotFoundException (404) al cliente', async () => {
    usersService.findByIdOrNull.mockResolvedValue(null);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(usersService.findOne).not.toHaveBeenCalled();
  });
});
