import { describe, expect, it } from 'vitest'
import type { OcrLine, RecognitionBox } from '../types'
import { findBarcodeRegions, findPrintedBarcode, resolveBarcode, splitOcrLine } from './recognition'

const region: RecognitionBox = { x0: 20, y0: 30, x1: 180, y1: 70 }
const line = (text: string, bbox: RecognitionBox): OcrLine => ({ text, bbox, confidence: 90 })

describe('spatial barcode recognition', () => {
  it('uses a unique long digit line directly below a barcode region', () => {
    const printed = findPrintedBarcode([
      line('2000123456789012', { x0: 30, y0: 5, x1: 170, y1: 20 }),
      line('0917123456789012', { x0: 32, y0: 76, x1: 168, y1: 91 })
    ], [region])
    expect(printed).toMatchObject({ value: '0917123456789012', region })
  })

  it('does not derive a barcode from OCR text without spatial association', () => {
    expect(findPrintedBarcode([
      line('0917123456789012', { x0: 220, y0: 76, x1: 390, y1: 91 })
    ], [region])).toBeUndefined()
  })

  it('always gives a technically decoded barcode priority', () => {
    expect(resolveBarcode(
      { value: 'decoded-value', format: 'QRCode', region },
      { value: '0917123456789012', region }
    )).toMatchObject({ barcodeValue: 'decoded-value', barcodeFormat: 'QRCode', barcodeSource: 'decoded' })
    expect(resolveBarcode(undefined, { value: '0917123456789012', region })).toMatchObject({
      barcodeValue: '0917123456789012', barcodeFormat: 'Code128', barcodeSource: 'printed-text'
    })
  })

  it('detects a synthetic vertical-bar region in raw pixels', () => {
    const width = 200
    const height = 120
    const data = new Uint8ClampedArray(width * height * 4).fill(255)
    for (let y = 30; y < 70; y++) for (let x = 20; x < 180; x++) {
      if (Math.floor((x - 20) / 3) % 2 === 0) {
        const offset = (y * width + x) * 4
        data[offset] = 0; data[offset + 1] = 0; data[offset + 2] = 0
      }
    }
    expect(findBarcodeRegions({ data, width, height })[0]).toMatchObject({ y0: 30, y1: 70 })
  })

  it('separates instruction text, PIN and voucher number merged by OCR', () => {
    const words = [
      { text: 'oder', confidence: 96, bbox: { x0: 270, y0: 370, x1: 299, y1: 380 } },
      { text: '9212', confidence: 96, bbox: { x0: 397, y0: 362, x1: 426, y1: 385 } },
      { text: '200000000015046912', confidence: 69, bbox: { x0: 505, y0: 366, x1: 656, y1: 378 } }
    ]
    expect(splitOcrLine(words, line('oder 9212 200000000015046912', { x0: 270, y0: 362, x1: 656, y1: 385 })).map((item) => item.text)).toEqual([
      'oder', '9212', '200000000015046912'
    ])
  })
})
