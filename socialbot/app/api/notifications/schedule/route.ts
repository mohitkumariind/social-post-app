export const runtime = 'nodejs';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * Security hardening:
 * This legacy public path is intentionally disabled to prevent accidental
 * exposure of notification scheduling without admin auth + RBAC enforcement.
 *
 * The only supported scheduling path is:
 *   /api/admin/notifications/schedule
 * which is protected by edge + route-layer auth and scoped RBAC checks.
 */
function deprecatedResponse(method: string) {
  console.warn(
    '[security.deprecated-endpoint]',
    JSON.stringify({
      endpoint: '/api/notifications/schedule',
      method,
      status: 410,
      reason: 'deprecated_public_schedule_stub_blocked',
    })
  );

  return json(
    {
      error: 'Gone',
      code: 'DEPRECATED_ENDPOINT',
      message: 'This endpoint is deprecated and disabled. Use /api/admin/notifications/schedule.',
    },
    410
  );
}

export async function GET() {
  return deprecatedResponse('GET');
}

export async function POST() {
  return deprecatedResponse('POST');
}

export async function PUT() {
  return deprecatedResponse('PUT');
}

export async function PATCH() {
  return deprecatedResponse('PATCH');
}

export async function DELETE() {
  return deprecatedResponse('DELETE');
}

