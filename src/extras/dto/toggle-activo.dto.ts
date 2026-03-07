import { IsBoolean } from "class-validator";

export class ToggleActivoDto {
  @IsBoolean()
  activo: boolean;
}