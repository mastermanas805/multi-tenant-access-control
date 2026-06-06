import { v4 as uuidv4, validate as uuidValidate } from 'uuid';

/**
 * A type-safe identity wrapper. Defaults to a v4 UUID when no value is supplied,
 * so aggregates can be constructed before they are persisted.
 */
export class UniqueEntityID {
  private readonly value: string;

  constructor(value?: string) {
    this.value = value ?? uuidv4();
  }

  public toString(): string {
    return this.value;
  }

  public toValue(): string {
    return this.value;
  }

  public equals(other?: UniqueEntityID): boolean {
    if (other === undefined || other === null) {
      return false;
    }
    if (!(other instanceof UniqueEntityID)) {
      return false;
    }
    return this.value === other.value;
  }

  public static isValidUuid(value: string): boolean {
    return uuidValidate(value);
  }
}
