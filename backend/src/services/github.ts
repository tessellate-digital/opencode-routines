import { createHmac, timingSafeEqual } from 'crypto';

export function verifySignature(
  payloadBody: Buffer,
  secret: string,
  signatureHeader: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const expected = `sha256=${createHmac('sha256', secret).update(payloadBody).digest('hex')}`;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

export function parseEvent(
  eventHeader: string,
  payload: Record<string, unknown>,
  allowedEvents: string[]
): [boolean, Record<string, unknown>] {
  const action = (payload.action as string) ?? '';

  for (const allowed of allowedEvents) {
    if (allowed.includes('.')) {
      const [evt, act] = allowed.split('.', 2);
      if (eventHeader === evt && action === act) {
        return [true, extractMetadata(eventHeader, payload)];
      }
    } else if (eventHeader === allowed) {
      return [true, extractMetadata(eventHeader, payload)];
    }
  }

  return [false, {}];
}

function extractMetadata(event: string, payload: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = { event };

  if (event === 'push') {
    meta.ref = payload.ref ?? '';
    meta.commits_count = Array.isArray(payload.commits) ? payload.commits.length : 0;
    const head = (payload.head_commit as Record<string, unknown>) ?? {};
    meta.head_commit = String(head.id ?? '').slice(0, 12);
    meta.message = String(head.message ?? '').slice(0, 200);
    meta.pusher = (payload.pusher as Record<string, unknown>)?.name ?? '';
  } else if (event === 'pull_request') {
    const pr = (payload.pull_request as Record<string, unknown>) ?? {};
    meta.action = payload.action ?? '';
    meta.pr_number = pr.number;
    meta.pr_title = String(pr.title ?? '').slice(0, 200);
    meta.pr_author = (pr.user as Record<string, unknown>)?.login ?? '';
    meta.base_branch = (pr.base as Record<string, unknown>)?.ref ?? '';
    meta.head_branch = (pr.head as Record<string, unknown>)?.ref ?? '';
  } else if (event === 'issues') {
    const issue = (payload.issue as Record<string, unknown>) ?? {};
    meta.action = payload.action ?? '';
    meta.issue_number = issue.number;
    meta.issue_title = String(issue.title ?? '').slice(0, 200);
  } else if (event === 'issue_comment') {
    meta.action = payload.action ?? '';
    meta.issue_number = (payload.issue as Record<string, unknown>)?.number;
    meta.comment_body = String((payload.comment as Record<string, unknown>)?.body ?? '').slice(
      0,
      500
    );
  } else {
    meta.action = payload.action ?? '';
  }

  return meta;
}
