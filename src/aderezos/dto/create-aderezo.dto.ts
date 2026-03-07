// src/aderezos/dto/create-aderezo.dto.ts
import { IsString, IsNotEmpty } from 'class-validator';

export class CreateAderezoDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;
}