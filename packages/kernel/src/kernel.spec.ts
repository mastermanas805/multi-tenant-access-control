import {
  AggregateRoot,
  Cursor,
  DomainError,
  DomainEvent,
  Guard,
  PageQuery,
  UnauthenticatedError,
  UniqueEntityID,
  ValidationError,
  ValueObject,
} from './index';

class SampleEvent extends DomainEvent {
  public readonly label: string;
  constructor(aggregateId: UniqueEntityID, label = 'sample') {
    super(aggregateId);
    this.label = label;
  }
  public eventName(): string {
    return 'sample.created';
  }
}

class SampleAggregate extends AggregateRoot<{ name: string }> {
  public static create(name: string): SampleAggregate {
    const agg = new SampleAggregate({ name });
    agg.addDomainEvent(new SampleEvent(agg.id));
    return agg;
  }
}

class Money extends ValueObject<{ cents: number }> {
  public static of(cents: number): Money {
    return new Money({ cents });
  }
}

describe('kernel building blocks', () => {
  it('UniqueEntityID equality + uuid default', () => {
    const a = new UniqueEntityID();
    expect(UniqueEntityID.isValidUuid(a.toString())).toBe(true);
    expect(a.equals(new UniqueEntityID(a.toString()))).toBe(true);
    expect(a.equals(new UniqueEntityID())).toBe(false);
  });

  it('AggregateRoot records and pulls domain events once', () => {
    const agg = SampleAggregate.create('x');
    expect(agg.domainEvents).toHaveLength(1);
    const pulled = agg.pullDomainEvents();
    expect(pulled).toHaveLength(1);
    expect(agg.domainEvents).toHaveLength(0);
  });

  it('ValueObject is structurally equal', () => {
    expect(Money.of(100).equals(Money.of(100))).toBe(true);
    expect(Money.of(100).equals(Money.of(200))).toBe(false);
  });

  it('Guard.invariant throws ValidationError with a stable code', () => {
    expect(() => {
      Guard.invariant(false, 'boom', 'because_reason');
    }).toThrow(ValidationError);
    try {
      Guard.invariant(false, 'boom', 'because_reason');
    } catch (err) {
      expect((err as ValidationError).code).toBe('validation_failed');
      expect((err as ValidationError).reason).toBe('because_reason');
    }
  });

  it('PageQuery clamps the limit and normalizes the cursor', () => {
    expect(PageQuery.from({ limit: 9999 }).limit).toBe(100);
    expect(PageQuery.from({ limit: 0 }).limit).toBe(1);
    expect(PageQuery.from({ cursor: '' }).cursor).toBeNull();
  });

  it('Cursor round-trips opaque values', () => {
    expect(Cursor.decode(Cursor.encode('row-42'))).toBe('row-42');
  });

  it('UnauthenticatedError carries the stable `unauthenticated` code and a generic default message', () => {
    const err = new UnauthenticatedError();
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('unauthenticated');
    expect(err.message).toBe('Authentication required');
    expect(err.reason).toBeUndefined();
  });

  it('UnauthenticatedError keeps the reason for logs while accepting a custom message', () => {
    const err = new UnauthenticatedError('Authentication required', 'invalid_signature');
    expect(err.reason).toBe('invalid_signature');
    expect(err.code).toBe('unauthenticated');
  });
});
