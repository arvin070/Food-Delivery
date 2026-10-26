'use client';
import { Button } from '@/components/ui/Button';
export function PrintReceipt() { return <Button className="print:hidden" onClick={() => window.print()}>Print / save as PDF</Button>; }
