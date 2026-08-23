import { NextRequest, NextResponse } from 'next/server';
import {
  getAllFormSubmissions,
  getFormSummaries,
  createFormSubmission,
  deleteFormSubmissionsByFormId,
  bulkDeleteFormSubmissions,
} from '@/lib/repositories/formSubmissionRepository';
import { dispatchFormSubmittedEvent } from '@/lib/services/webhookService';
import { sendFormSubmissionEmail, extractReplyToEmail } from '@/lib/services/emailService';
import { processAppIntegrations } from '@/lib/apps/integration-service';
import { noCache } from '@/lib/api-response';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import {
  createSlidingWindowRateLimiter,
  findPublicFormConfig,
  isValidFormId,
  sanitizeFormPayload,
} from '@/lib/form-submission-security';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowSubmission = createSlidingWindowRateLimiter(10, 60_000);

/**
 * GET /ycode/api/form-submissions
 * Get all form submissions or form summaries
 *
 * Query params:
 * - form_id: Filter by form ID
 * - status: Filter by status
 * - summary: If 'true', returns form summaries instead of submissions
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const formId = searchParams.get('form_id') || undefined;
    const status = searchParams.get('status') as 'new' | 'read' | 'archived' | 'spam' | undefined;
    const summary = searchParams.get('summary') === 'true';

    if (summary) {
      const summaries = await getFormSummaries();
      return noCache({ data: summaries });
    }

    const submissions = await getAllFormSubmissions(formId, status);
    return noCache({ data: submissions });
  } catch (error) {
    console.error('Error fetching form submissions:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch form submissions' },
      500
    );
  }
}

/**
 * POST /ycode/api/form-submissions
 * Create a new form submission (public endpoint for form submissions)
 *
 * Body:
 * - form_id: string (required)
 * - payload: object (required)
 * - metadata: object (optional - IP, user agent, etc.)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!isValidFormId(body.form_id)) {
      return NextResponse.json({ error: 'Invalid form_id' }, { status: 400 });
    }

    // A hidden field catches indiscriminate form bots. Return success so they
    // do not learn which signal triggered the rejection.
    if (typeof body.honeypot === 'string' && body.honeypot.trim() !== '') {
      return NextResponse.json({ data: null, message: 'Form submitted successfully' }, { status: 201 });
    }

    const payload = sanitizeFormPayload(body.payload);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const clientIp = forwardedFor || request.headers.get('x-real-ip') || 'unknown';
    if (!allowSubmission(`${clientIp}:${body.form_id}`)) {
      return NextResponse.json({ error: 'Too many submissions' }, { status: 429 });
    }

    const client = await getSupabaseAdmin();
    if (!client) {
      return NextResponse.json({ error: 'Form service unavailable' }, { status: 503 });
    }
    const { data: layerRows, error: layersError } = await client
      .from('page_layers')
      .select('layers')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(500);
    if (layersError) throw new Error(`Failed to validate form: ${layersError.message}`);

    const formConfig = findPublicFormConfig(layerRows ?? [], body.form_id);
    if (!formConfig) {
      return NextResponse.json({ error: 'Unknown form_id' }, { status: 404 });
    }

    // Metadata is derived at the boundary; callers cannot forge headers or
    // inject arbitrary objects into the stored submission.
    const requestedPageUrl = typeof body.metadata?.page_url === 'string'
      ? body.metadata.page_url.slice(0, 2_048)
      : undefined;
    const metadata = {
      user_agent: request.headers.get('user-agent')?.slice(0, 512) || undefined,
      referrer: request.headers.get('referer')?.slice(0, 2_048) || undefined,
      page_url: requestedPageUrl,
    };

    const submission = await createFormSubmission({
      form_id: body.form_id,
      payload,
      metadata,
    });

    // Dispatch webhook event (fire and forget)
    dispatchFormSubmittedEvent({
      form_id: body.form_id,
      submission_id: submission.id,
      fields: payload,
      metadata,
    }).catch((error) => console.error('Failed to dispatch form webhook:', error));

    // Send email notification if enabled (fire and forget)
    if (formConfig.notification) {
      // Extract reply-to email from form payload (first email field found)
      const replyTo = extractReplyToEmail(payload);

      void sendFormSubmissionEmail(
        formConfig.notification.to,
        formConfig.notification.subject || `New form submission: ${body.form_id}`,
        {
          formId: body.form_id,
          submissionId: submission.id,
          payload,
          metadata: {
            ...metadata,
            submitted_at: submission.created_at,
          },
          replyTo,
        }
      ).catch((error) => console.error('Failed to send form email:', error));
    }

    // Process app integrations (fire and forget)
    void processAppIntegrations(body.form_id, submission.id, payload)
      .catch((error) => console.error('Failed to process form integrations:', error));

    return NextResponse.json(
      { data: submission, message: 'Form submitted successfully' },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating form submission:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to submit form' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /ycode/api/form-submissions
 * Delete submissions - either by form_id (all submissions) or by ids (bulk delete)
 *
 * Query params:
 * - form_id: string - Delete all submissions for this form
 *
 * OR Body:
 * - ids: string[] - Array of submission IDs to delete
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const formId = searchParams.get('form_id');

    // If form_id is provided, delete all submissions for that form
    if (formId) {
      await deleteFormSubmissionsByFormId(formId);
      return noCache({ message: 'All submissions for form deleted successfully' });
    }

    // Otherwise, try to parse body for bulk delete
    const body = await request.json().catch(() => ({}));
    const ids = body.ids;

    if (Array.isArray(ids) && ids.length > 0) {
      await bulkDeleteFormSubmissions(ids);
      return noCache({ message: `${ids.length} submissions deleted successfully` });
    }

    return noCache({ error: 'Missing required param: form_id or ids in body' }, 400);
  } catch (error) {
    console.error('Error deleting form submissions:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to delete form submissions' },
      500
    );
  }
}
