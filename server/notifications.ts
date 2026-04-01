import type { Server as SocketServer } from 'socket.io';

export type NotificationEventType =
  | 'agent-started'
  | 'status-change'
  | 'needs-input'
  | 'completed'
  | 'error'
  | 'chain-triggered';

export interface NotificationEvent {
  type: NotificationEventType;
  taskId: string;
  data: any;
}

export interface NotificationPayload {
  type: NotificationEventType;
  taskId: string;
  title: string;
  message: string;
  data: any;
  timestamp: string;
}

/**
 * Manages notification delivery via Socket.io.
 * Emits toast, browser, and sound notification events.
 */
export class NotificationManager {
  /**
   * Emit a notification event to all connected clients.
   */
  emit(io: SocketServer, event: NotificationEvent): void {
    const payload = this.buildPayload(event);

    // Emit to the task-specific room
    io.to(`task:${event.taskId}`).emit('notification', payload);

    // Also emit to a global notification channel for dashboard-level listeners
    io.emit('notification:global', payload);
  }

  /**
   * Build a notification payload with human-readable title/message.
   */
  private buildPayload(event: NotificationEvent): NotificationPayload {
    const { type, taskId, data } = event;
    let title: string;
    let message: string;

    switch (type) {
      case 'agent-started':
        title = 'Agent Started';
        message = data?.title
          ? `Agent started working on "${data.title}"`
          : 'An agent has started working on a task';
        break;

      case 'status-change':
        title = 'Status Changed';
        message = data?.status
          ? `Task status changed to: ${data.status}`
          : 'Task status has been updated';
        break;

      case 'needs-input':
        title = 'Input Required';
        message = data?.prompt
          ? `Agent is waiting for input: ${data.prompt}`
          : 'An agent is waiting for user input';
        break;

      case 'completed':
        title = 'Task Completed';
        message = data?.title
          ? `Task "${data.title}" has been completed`
          : 'A task has been completed';
        break;

      case 'error':
        title = 'Error';
        message = data?.message
          ? `Error: ${data.message}`
          : 'An error occurred during task execution';
        break;

      case 'chain-triggered':
        title = 'Chain Triggered';
        message = data?.title
          ? `Dependent task "${data.title}" has been automatically started`
          : 'A dependent task has been triggered';
        break;

      default:
        title = 'Notification';
        message = 'An event occurred';
    }

    return {
      type,
      taskId,
      title,
      message,
      data,
      timestamp: new Date().toISOString(),
    };
  }
}
