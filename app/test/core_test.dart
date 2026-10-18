import 'package:contabili/core/dates.dart';
import 'package:contabili/core/documents.dart';
import 'package:contabili/core/igv.dart';
import 'package:contabili/core/money.dart';
import 'package:contabili/core/operations.dart';
import 'package:contabili/core/ruc.dart';
import 'package:flutter_test/flutter_test.dart';

// Mismos casos que las pruebas del backend: las reglas de la app las replican.
void main() {
  group('dinero', () {
    test('muestra soles en formato peruano', () {
      expect(formatSoles(1550), 'S/ 15.50');
      expect(formatSoles(123456789), 'S/ 1,234,567.89');
      expect(formatSoles(-5), '-S/ 0.05');
    });

    test('entiende lo que escribe la persona', () {
      expect(parseSoles('118'), 11800);
      expect(parseSoles('118.5'), 11850);
      expect(parseSoles('118,50'), 11850);
      expect(parseSoles('S/ 1,200.00'), 120000);
      expect(parseSoles('1.200,50'), 120050);
      expect(parseSoles('1,200'), 120000);
      expect(parseSoles(''), isNull);
      expect(parseSoles('12.345'), isNull);
      expect(parseSoles('abc'), isNull);
    });
  });

  group('IGV (backend/src/tax/igv.spec.ts)', () {
    test('separa la base de un precio con IGV sin perder céntimos', () {
      expect(igvFromTotal(11800), const IgvBreakdown(base: 10000, igv: 1800, total: 11800));
      for (final total in [1, 99, 1829, 1550, 123457]) {
        final b = igvFromTotal(total);
        expect(b.base + b.igv, total);
      }
    });
  });

  group('operaciones (backend/src/accounting/operations.spec.ts)', () {
    test('venta con IGV y en el Nuevo RUS sin IGV', () {
      const sale = Sale(11800, kind: SaleKind.goods, paidWith: Settlement.cash);
      expect(operationIgv(sale, TaxRegime.rmt).igv, 1800);
      expect(operationIgv(sale, TaxRegime.nrus).igv, 0);
    });

    test('gasto: con factura descuenta IGV; sueldos nunca', () {
      const services = Expense(
        23600,
        category: ExpenseCategory.services,
        paidWith: Settlement.bank,
        withInvoice: true,
      );
      expect(operationIgv(services, TaxRegime.rmt).igv, 3600);
      const payroll = Expense(
        150000,
        category: ExpenseCategory.payroll,
        paidWith: Settlement.credit,
        withInvoice: true,
      );
      expect(operationIgv(payroll, TaxRegime.rmt).igv, 0);
    });

    test('se envía como lo espera la API', () {
      expect(
        const Expense(
          5900,
          category: ExpenseCategory.services,
          paidWith: Settlement.bank,
          withInvoice: true,
        ).toJson(),
        {
          'type': 'expense',
          'total': 5900,
          'category': 'services',
          'paidWith': 'bank',
          'withInvoice': true,
        },
      );
      expect(const Collection(100, into: Money.bank).toJson(), {
        'type': 'collection',
        'total': 100,
        'into': 'bank',
      });
    });
  });

  group('RUC (backend/src/tax/ruc.spec.ts)', () {
    test('calcula el verificador y valida', () {
      expect(rucCheckDigit('2013131295'), 5);
      expect(isValidRuc('20131312955'), isTrue);
      expect(isValidRuc('20131312954'), isFalse);
      expect(isValidRuc('2013131295'), isFalse);
      const badPrefix = '3013131295';
      expect(isValidRuc('$badPrefix${rucCheckDigit(badPrefix)}'), isFalse);
    });
  });

  group('fechas de Lima', () {
    test('usa UTC−5', () {
      expect(limaDate(DateTime.utc(2026, 11, 1, 3)), '2026-10-31');
      expect(limaDate(DateTime.utc(2026, 11, 1, 5)), '2026-11-01');
    });

    test('meses', () {
      expect(periodLabel('2026-10'), 'octubre de 2026');
      expect(shiftPeriod('2026-01', -1), '2025-12');
      expect(shiftPeriod('2026-12', 1), '2027-01');
      expect(formatDate('2026-03-31'), '31/03/2026');
      expect(periodBounds('2026-02'), ('2026-02-01', '2026-02-28'));
      expect(periodBounds('2028-02'), ('2028-02-01', '2028-02-29'));
      expect(periodBounds('2026-12'), ('2026-12-01', '2026-12-31'));
    });
  });

  group('comprobantes (backend/src/accounting/document-rules.spec.ts)', () {
    const ruc = '20131312955';
    final personRuc = '1045678912${rucCheckDigit('1045678912')}';
    const sale = Sale(11800, kind: SaleKind.goods, paidWith: Settlement.cash);
    const withInvoice = Expense(
      11800,
      category: ExpenseCategory.goods,
      paidWith: Settlement.cash,
      withInvoice: true,
    );
    const noInvoice = Expense(
      11800,
      category: ExpenseCategory.goods,
      paidWith: Settlement.cash,
      withInvoice: false,
    );
    OperationDocument factura({String series = 'F001', int number = 123, String? ruc = ruc}) =>
        OperationDocument(
          type: DocType.factura,
          series: series,
          number: number,
          counterpartyRuc: ruc,
        );
    const boleta = OperationDocument(type: DocType.boleta, series: 'B001', number: 45);

    test('factura de venta con el RUC del cliente; boleta sin RUC', () {
      expect(documentProblem(sale, factura(), TaxRegime.rmt), isNull);
      expect(documentProblem(sale, factura(ruc: null), TaxRegime.rmt), contains('RUC'));
      expect(documentProblem(sale, factura(ruc: '20131312954'), TaxRegime.rmt), contains('RUC'));
      expect(documentProblem(sale, boleta, TaxRegime.rmt), isNull);
    });

    test('en el Nuevo RUS no se emiten facturas', () {
      expect(documentProblem(sale, factura(), TaxRegime.nrus), contains('Nuevo RUS'));
      expect(documentProblem(sale, boleta, TaxRegime.nrus), isNull);
    });

    test('el recibo por honorarios es solo de compra y lleva RUC', () {
      const recibo = OperationDocument(type: DocType.recibo, series: 'E001', number: 7);
      expect(documentProblem(sale, recibo, TaxRegime.rmt), isNotNull);
      expect(documentProblem(noInvoice, recibo, TaxRegime.rmt), contains('RUC'));
      expect(
        documentProblem(
          noInvoice,
          OperationDocument(
            type: DocType.recibo,
            series: 'E001',
            number: 7,
            counterpartyRuc: personRuc,
          ),
          TaxRegime.rmt,
        ),
        isNull,
      );
    });

    test('«tengo factura» va solo con factura (menos en el Nuevo RUS)', () {
      expect(documentProblem(withInvoice, factura(), TaxRegime.rmt), isNull);
      expect(documentProblem(noInvoice, factura(), TaxRegime.rmt), isNotNull);
      expect(documentProblem(withInvoice, boleta, TaxRegime.rmt), isNotNull);
      expect(documentProblem(noInvoice, factura(), TaxRegime.nrus), isNull);
    });

    test('serie y número', () {
      expect(normalizeSeries(' f001 '), 'F001');
      expect(isValidSeries(DocType.factura, 'F001'), isTrue);
      expect(isValidSeries(DocType.factura, '0001'), isTrue);
      expect(isValidSeries(DocType.factura, 'F0001'), isFalse);
      expect(isValidSeries(DocType.boleta, 'B-01'), isFalse);
      expect(isValidSeries(DocType.ticket, 'FFCF123456-7'), isTrue);
      expect(documentProblem(sale, factura(series: 'F 001'), TaxRegime.rmt), isNull);
      expect(documentProblem(sale, factura(series: 'F00001'), TaxRegime.rmt), isNotNull);
      expect(documentProblem(sale, factura(number: 0), TaxRegime.rmt), isNotNull);
      expect(documentProblem(sale, factura(number: 100000000), TaxRegime.rmt), isNotNull);
      expect(factura().label, 'F001-123');
    });
  });
}
