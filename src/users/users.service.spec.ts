import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  /**
   * Los dos caminos de búsqueda por id existen a propósito y NO son
   * intercambiables: el flujo de auth necesita null (para responder 401) y el
   * panel necesita la excepción (para responder 404).
   */
  describe('findByIdOrNull', () => {
    it('devuelve el usuario si existe', async () => {
      const usuario = { id: 'abc', email: 'a@a.com', activo: true };
      prisma.user.findUnique.mockResolvedValue(usuario);

      await expect(service.findByIdOrNull('abc')).resolves.toEqual(usuario);
    });

    it('devuelve null si no existe, sin tirar excepción', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      // Si esto tirara NotFoundException, el 404 se escaparía al cliente en
      // cualquier endpoint autenticado (era el bug del usuario borrado).
      await expect(service.findByIdOrNull('borrado')).resolves.toBeNull();
    });
  });

  describe('findOne', () => {
    it('devuelve el usuario si existe', async () => {
      const usuario = { id: 'abc', email: 'a@a.com', activo: true };
      prisma.user.findUnique.mockResolvedValue(usuario);

      await expect(service.findOne('abc')).resolves.toEqual(usuario);
    });

    it('sigue tirando NotFoundException si no existe (GET /users/:id)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findOne('borrado')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
