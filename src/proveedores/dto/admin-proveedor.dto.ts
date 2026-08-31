import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * Normaliza un campo de texto opcional: recorta y convierte el vacio en `null`.
 *
 * Los dos motivos, y los dos son bugs reales del DTO viejo:
 *
 * 1. Un form HTML manda `""`, no `undefined`, para el input que el usuario
 *    dejo en blanco. `@IsOptional()` solo saltea `null`/`undefined`, asi que
 *    `email: ""` llegaba a `@IsEmail()` y devolvia 400: con el DTO viejo NO SE
 *    PUEDE crear un proveedor sin email desde la pantalla.
 * 2. El `.trim()` estaba en el service, o sea DESPUES de validar, asi que un
 *    nombre de puros espacios pasaba el `@IsString()` y se guardaba vacio.
 *
 * `null` y no `undefined` a proposito: en el PATCH hay que poder BORRAR un
 * telefono mandando el campo vacio, y `undefined` significa "no lo toques".
 */
function TextoOpcional() {
  return Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const limpio = value.trim();
    return limpio === '' ? null : limpio;
  });
}

/** Campos de contacto. Iguales en el alta y en la edicion. */
class ContactoProveedorDto {
  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  @IsOptional()
  @TextoOpcional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(40, { message: 'telefono no puede superar los 40 caracteres' })
  telefono?: string | null;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  @IsOptional()
  @TextoOpcional()
  // Se valida el formato solo si vino algo: vacio significa "sin email", que
  // es un valor legitimo y no un email mal escrito.
  @ValidateIf((_, value) => value !== null)
  @IsEmail({}, { message: 'email no tiene un formato valido' })
  @MaxLength(120, { message: 'email no puede superar los 120 caracteres' })
  email?: string | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @TextoOpcional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500, { message: 'notas no puede superar los 500 caracteres' })
  notas?: string | null;
}

export class CrearProveedorDto extends ContactoProveedorDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'nombre es obligatorio' })
  @IsNotEmpty({ message: 'nombre es obligatorio' })
  @MaxLength(120, { message: 'nombre no puede superar los 120 caracteres' })
  nombre: string;
}

export class EditarProveedorDto extends ContactoProveedorDto {
  /**
   * Opcional, pero si viene tiene que ser un nombre de verdad: `nombre: ""`
   * en un PATCH es un error del que llama, no un pedido de dejarlo vacio (la
   * columna es NOT NULL y ademas es la unica forma de identificar la ficha).
   */
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'nombre no puede quedar vacio' })
  @MaxLength(120, { message: 'nombre no puede superar los 120 caracteres' })
  nombre?: string;
}
