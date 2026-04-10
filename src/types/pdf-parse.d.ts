declare module "pdf-parse/lib/pdf-parse.js" {
  interface PDFPageData {
    getTextContent: (opts: object) => Promise<{
      items: Array<{ str: string; transform: number[] }>;
    }>;
    getAnnotations: () => Promise<
      Array<{ annotationType: number; url?: string }>
    >;
  }

  interface PDFData {
    numpages: number;
    numrender: number;
    info: Record<string, unknown> | null;
    metadata: unknown;
    text: string;
    version: string | null;
  }

  interface PDFOptions {
    pagerender?: (pageData: PDFPageData) => Promise<string>;
    max?: number;
    version?: string;
  }

  function PDFParse(dataBuffer: Buffer, options?: PDFOptions): Promise<PDFData>;
  export default PDFParse;
}
