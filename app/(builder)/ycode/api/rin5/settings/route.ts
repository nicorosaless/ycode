import { NextRequest, NextResponse } from 'next/server'

import { parseRin5CustomerSettings, RIN5_CUSTOMER_SETTING_KEYS } from '@/lib/rin5-customer-settings'
import { getSettingsByKeys, setSettings } from '@/lib/repositories/settingsRepository'
import { clearAllCache } from '@/lib/services/cacheService'

export async function GET() {
  try {
    return NextResponse.json({ data: await getSettingsByKeys([...RIN5_CUSTOMER_SETTING_KEYS]) })
  } catch (error) {
    console.error('[rin5 settings] read failed', error)
    return NextResponse.json({ error: 'Failed to read settings' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const settings = parseRin5CustomerSettings(await request.json())
    await setSettings(settings)
    await clearAllCache()
    return NextResponse.json({ data: settings })
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.name === 'ZodError')) {
      return NextResponse.json({ error: 'Invalid customer settings' }, { status: 400 })
    }
    console.error('[rin5 settings] update failed', error)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
