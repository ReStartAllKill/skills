import { describe, expect, it } from 'vitest'
import { assertSingleStore, isSupported } from './store'

describe('content store', () => {
  it('test_UploadRejectsUnsupportedStore', () => {
    expect(isSupported('tape')).toBe(false)
  })

  it('test_UploadRejectsMixedStore', () => {
    expect(() => assertSingleStore(['object', 'block'])).toThrow()
  })
})
