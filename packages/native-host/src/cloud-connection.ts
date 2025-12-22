import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { WSClientMessage, WSServerMessage } from '@bmaestro/shared/types';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface CloudConnectionOptions {
  url: string;
  deviceId: string;
  userId: string;
  secret?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export class CloudConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private _state: ConnectionState = 'disconnected';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;

  constructor(private options: CloudConnectionOptions) {
    super();
  }

  get state(): ConnectionState {
    return this._state;
  }

  private setState(state: ConnectionState): void {
    if (this._state !== state) {
      this._state = state;
      this.emit('stateChange', state);
    }
  }

  connect(): void {
    if (this._state === 'connected' || this._state === 'connecting') {
      return;
    }

    this.setState('connecting');

    const url = new URL(this.options.url);
    url.searchParams.set('deviceId', this.options.deviceId);
    url.searchParams.set('userId', this.options.userId);

    // Pass secret in headers if provided
    const headers: Record<string, string> = {};
    if (this.options.secret) {
      headers['x-sync-secret'] = this.options.secret;
    }

    this.ws = new WebSocket(url.toString(), { headers });

    this.ws.on('open', () => {
      this.reconnectAttempts = 0;
      this.setState('connected');
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as WSServerMessage;
        this.emit('message', message);
      } catch (error) {
        this.emit('error', error);
      }
    });

    this.ws.on('close', () => {
      this.ws = null;
      this.setState('disconnected');
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      this.emit('error', error);
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setState('disconnected');
  }

  send(message: WSClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.emit('error', new Error('Not connected'));
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  private scheduleReconnect(): void {
    const maxAttempts = this.options.maxReconnectAttempts ?? 10;
    if (this.reconnectAttempts >= maxAttempts) {
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    const interval = this.options.reconnectInterval ?? 5000;
    const delay = Math.min(interval * Math.pow(2, this.reconnectAttempts), 60000);

    this.setState('reconnecting');
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  ping(): void {
    this.send({ type: 'PING' });
  }
}
