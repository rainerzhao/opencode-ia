'use strict';

const express = require('express');
const WebSocket = require('ws');

const PUBLIC_ERRORS = Object.freeze({
  CONVERSATION_NOT_FOUND: 'Conversation was not found',
  CONVERSATION_ARCHIVED: 'Archived conversation cannot accept jobs',
  JOB_NOT_FOUND: 'Job was not found',
  IDEMPOTENCY_CONFLICT: 'Idempotency key was already used',
  USER_QUEUE_LIMIT: 'User queue limit was reached',
  GATEWAY_UNAVAILABLE: 'Gateway is unavailable',
  INVALID_EVENT_SEQUENCE: 'Event sequence is invalid'
});

function routeError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function safeIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
}

function requireIdentifier(value) {
  if (!safeIdentifier(value)) throw routeError('INVALID_MESSAGE', 'Message fields are invalid', 400);
  return value;
}

function requirePromptText(value) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    Array.from(value).length > 100000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  ) {
    throw routeError('INVALID_MESSAGE', 'Message fields are invalid', 400);
  }
  return value;
}

function normalizeGatewayError(error) {
  if (error?.code === 'INVALID_MESSAGE' || error instanceof SyntaxError || error instanceof TypeError) {
    return { code: 'INVALID_MESSAGE', message: 'Message fields are invalid' };
  }
  if (Object.hasOwn(PUBLIC_ERRORS, error?.code)) {
    return { code: error.code, message: PUBLIC_ERRORS[error.code] };
  }
  return { code: 'GATEWAY_UNAVAILABLE', message: PUBLIC_ERRORS.GATEWAY_UNAVAILABLE };
}

function httpStatusFor(code) {
  return ({
    CONVERSATION_NOT_FOUND: 404,
    JOB_NOT_FOUND: 404,
    CONVERSATION_ARCHIVED: 409,
    IDEMPOTENCY_CONFLICT: 409,
    USER_QUEUE_LIMIT: 429,
    GATEWAY_UNAVAILABLE: 503
  })[code] || 400;
}

function createGatewayRouter({ gatewayService, requestAuditor }) {
  if (!gatewayService || !requestAuditor) throw new TypeError('gateway route dependencies are required');
  const router = express.Router();

  router.post('/:conversationId/jobs/:jobId/cancel', async (req, res, next) => {
    try {
      const conversationId = requireIdentifier(req.params.conversationId);
      const jobId = requireIdentifier(req.params.jobId);
      const job = await gatewayService.cancel({
        conversationId,
        jobId,
        userId: req.auth.user.id
      });
      requestAuditor.record(req, {
        action: 'gateway.job.cancel',
        targetType: 'gateway_job',
        targetId: job.id,
        metadata: { conversationId }
      });
      res.json({ job });
    } catch (error) {
      const safe = normalizeGatewayError(error);
      next(routeError(safe.code, safe.message, httpStatusFor(safe.code)));
    }
  });

  return router;
}

function attachGatewaySocket({
  ws,
  req,
  authService,
  gatewayService,
  requestAuditor,
  logger,
  session,
  onClose
}) {
  if (!ws || !req || !authService || !gatewayService || !requestAuditor || !session) {
    throw new TypeError('gateway socket dependencies are required');
  }
  const subscriptions = new Map();

  function send(payload) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  function sendError(error) {
    const safe = normalizeGatewayError(error);
    send({ type: 'error', code: safe.code, message: safe.message });
  }

  async function authenticate() {
    try {
      req.auth = await authService.authenticate(req.authToken);
      return req.auth;
    } catch {
      ws.close(1008, 'AUTHENTICATION_REQUIRED');
      return null;
    }
  }

  async function handleMessage(raw, isBinary) {
    if (!await authenticate()) return;
    let message;
    try {
      if (isBinary) throw routeError('INVALID_MESSAGE', 'Message fields are invalid', 400);
      message = JSON.parse(raw.toString());
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        throw routeError('INVALID_MESSAGE', 'Message fields are invalid', 400);
      }
      const userId = req.auth.user.id;
      const conversationId = requireIdentifier(message.conversationId);

      if (message.type === 'subscribe') {
        if (!Number.isInteger(message.afterSequence) || message.afterSequence < 0) {
          throw routeError('INVALID_MESSAGE', 'Message fields are invalid', 400);
        }
        subscriptions.get(conversationId)?.();
        const unsubscribe = await gatewayService.subscribe({
          conversationId,
          userId,
          afterSequence: message.afterSequence,
          onEvent: send
        });
        subscriptions.set(conversationId, unsubscribe);
        return;
      }

      if (message.type === 'prompt') {
        const text = requirePromptText(message.text);
        const idempotencyKey = requireIdentifier(message.idempotencyKey);
        const job = await gatewayService.submit({
          conversationId,
          userId,
          idempotencyKey,
          inputText: text
        });
        requestAuditor.record(req, {
          action: 'gateway.prompt.submit',
          targetType: 'gateway_job',
          targetId: job.id,
          metadata: {
            conversationId,
            inputLength: Array.from(text).length,
            deduplicated: job.deduplicated === true
          }
        });
        send({
          type: 'job.accepted',
          conversationId,
          jobId: job.id,
          deduplicated: job.deduplicated === true
        });
        return;
      }

      if (message.type === 'cancel') {
        const jobId = requireIdentifier(message.jobId);
        const job = await gatewayService.cancel({ conversationId, jobId, userId });
        requestAuditor.record(req, {
          action: 'gateway.job.cancel',
          targetType: 'gateway_job',
          targetId: job.id,
          metadata: { conversationId }
        });
        return;
      }

      throw routeError('INVALID_MESSAGE', 'Message fields are invalid', 400);
    } catch (error) {
      logger?.error?.(`[Gateway] ${session.id} message failed: ${normalizeGatewayError(error).code}`);
      sendError(error);
    }
  }

  ws.on('message', (raw, isBinary) => { void handleMessage(raw, isBinary); });
  ws.on('close', () => {
    for (const unsubscribe of subscriptions.values()) unsubscribe();
    subscriptions.clear();
    onClose?.();
  });
}

module.exports = { attachGatewaySocket, createGatewayRouter };
