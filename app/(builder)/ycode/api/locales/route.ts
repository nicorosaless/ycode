import { NextRequest, NextResponse } from 'next/server';
import { getAllLocales, createLocale } from '@/lib/repositories/localeRepository';
import { parseCreateLocale } from '@/lib/locale-input';

/**
 * GET /ycode/api/locales
 * Get all locales
 */
export async function GET() {
  try {
    const locales = await getAllLocales();
    
    return NextResponse.json({ data: locales });
  } catch (error) {
    console.error('Error fetching locales:', error);
    return NextResponse.json(
      { error: 'Failed to fetch locales' },
      { status: 500 }
    );
  }
}

/**
 * POST /ycode/api/locales
 * Create a new locale
 */
export async function POST(request: NextRequest) {
  try {
    const localeData = parseCreateLocale(await request.json());
    const { locale, locales } = await createLocale(localeData);
    
    return NextResponse.json({ data: { locale, locales } }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.name === 'ZodError')) {
      return NextResponse.json({ error: 'Invalid locale' }, { status: 400 });
    }
    console.error('Error creating locale:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create locale' },
      { status: 500 }
    );
  }
}
