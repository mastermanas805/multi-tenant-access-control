import { UniqueEntityID } from './unique-entity-id';

/**
 * Base class for all entities. Identity is by id, not by attribute value.
 * `TProps` is the entity's property bag; subclasses expose typed getters over it.
 */
export abstract class Entity<TProps> {
  protected readonly _id: UniqueEntityID;
  protected readonly props: TProps;

  protected constructor(props: TProps, id?: UniqueEntityID) {
    this._id = id ?? new UniqueEntityID();
    this.props = props;
  }

  public get id(): UniqueEntityID {
    return this._id;
  }

  /** Two entities are equal iff they are the same reference or share the same identity. */
  public equals(other?: Entity<TProps>): boolean {
    if (other === undefined || other === null) {
      return false;
    }
    if (this === other) {
      return true;
    }
    if (!(other instanceof Entity)) {
      return false;
    }
    return this._id.equals(other._id);
  }
}
