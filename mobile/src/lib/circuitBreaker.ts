type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  halfOpenMaxAttempts: number;
}

interface CircuitStats {
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  state: CircuitState;
  halfOpenAttempts: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 30000, // 30 seconds
  halfOpenMaxAttempts: 3,
};

class CircuitBreaker {
  private circuits: Map<string, CircuitStats> = new Map();
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private getCircuit(key: string): CircuitStats {
    if (!this.circuits.has(key)) {
      this.circuits.set(key, {
        failures: 0,
        successes: 0,
        lastFailureTime: null,
        state: 'CLOSED',
        halfOpenAttempts: 0,
      });
    }
    return this.circuits.get(key)!;
  }

  private updateState(circuit: CircuitStats): void {
    const now = Date.now();

    // Check if we should transition from OPEN to HALF_OPEN
    if (
      circuit.state === 'OPEN' &&
      circuit.lastFailureTime &&
      now - circuit.lastFailureTime >= this.config.resetTimeout
    ) {
      circuit.state = 'HALF_OPEN';
      circuit.halfOpenAttempts = 0;
    }
  }

  canExecute(key: string): boolean {
    const circuit = this.getCircuit(key);
    this.updateState(circuit);

    switch (circuit.state) {
      case 'CLOSED':
        return true;
      case 'OPEN':
        return false;
      case 'HALF_OPEN':
        return circuit.halfOpenAttempts < this.config.halfOpenMaxAttempts;
      default:
        return true;
    }
  }

  recordSuccess(key: string): void {
    const circuit = this.getCircuit(key);

    if (circuit.state === 'HALF_OPEN') {
      circuit.successes++;
      // After successful attempts in half-open, close the circuit
      if (circuit.successes >= this.config.halfOpenMaxAttempts) {
        circuit.state = 'CLOSED';
        circuit.failures = 0;
        circuit.successes = 0;
        circuit.halfOpenAttempts = 0;
      }
    } else {
      circuit.failures = 0;
      circuit.successes++;
    }
  }

  recordFailure(key: string): void {
    const circuit = this.getCircuit(key);
    circuit.failures++;
    circuit.lastFailureTime = Date.now();

    if (circuit.state === 'HALF_OPEN') {
      circuit.halfOpenAttempts++;
      // If we fail during half-open, go back to open
      if (circuit.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        circuit.state = 'OPEN';
      }
    } else if (circuit.failures >= this.config.failureThreshold) {
      circuit.state = 'OPEN';
    }
  }

  getState(key: string): CircuitState {
    const circuit = this.getCircuit(key);
    this.updateState(circuit);
    return circuit.state;
  }

  getStats(key: string): CircuitStats {
    return { ...this.getCircuit(key) };
  }

  reset(key: string): void {
    this.circuits.delete(key);
  }

  resetAll(): void {
    this.circuits.clear();
  }

  async execute<T>(
    key: string,
    fn: () => Promise<T>,
    fallback?: () => T | Promise<T>
  ): Promise<T> {
    if (!this.canExecute(key)) {
      if (fallback) {
        return fallback();
      }
      throw new Error(`Circuit breaker is open for: ${key}`);
    }

    try {
      const result = await fn();
      this.recordSuccess(key);
      return result;
    } catch (error) {
      this.recordFailure(key);
      if (fallback && this.getState(key) === 'OPEN') {
        return fallback();
      }
      throw error;
    }
  }
}

// Singleton instance
export const circuitBreaker = new CircuitBreaker();

// Helper to create endpoint-specific circuit breaker keys
export const getCircuitKey = (endpoint: string): string => {
  // Group endpoints by base path
  const basePath = endpoint.split('/').slice(0, 2).join('/');
  return `api:${basePath}`;
};
