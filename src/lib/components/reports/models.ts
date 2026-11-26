import { STATUS_MAP, type StatusKind, type StatusMeta } from '$lib/components/ui';
import { formatDate, formatMoney, formatNumber } from '$lib/format';
import { BOND_COMMERCIAL_STATUS_LABELS, BOND_FINANCIAL_STATUS_LABELS } from '$lib/domain/bonds';
import {
	INSTALLMENT_BUCKET_LABELS,
	INSTALLMENT_BUCKETS,
	formatMonthLabel
} from '$lib/domain/reports';
import {
	LEDGER_DIRECTION_LABELS,
	LEDGER_ENTRY_TYPE_LABELS,
	LEDGER_STATUS_LABELS
} from '$lib/domain/ledger';
import {
	PRIZE_STATUSES,
	PRIZE_STATUS_LABELS,
	WINNING_NUMBER_STATUS_LABELS
} from '$lib/domain/prizes';
import { drawStatusLabel, drawTypeLabel, type ReportExportKey } from '$lib/domain/report-exports';
import type { ReportField, ReportRow } from '$lib/report-views';
import type { PageData as OperationalData } from '../../../routes/campaigns/[id]/reports/$types';
import type { PageData as FinancialData } from '../../../routes/campaigns/[id]/reports/financial/$types';

/** Whole pesos are a display rounding only; exports and ledger figures keep their cents. */
export const screenMoney = (value: string | number) => formatMoney(Math.round(Number(value)));
type Field = ReportField & { money?: boolean };
interface Model {
	title: string;
	fields: Field[];
	rows: ReportRow[];
	totals: { label: string; value: string }[];
	report?: ReportExportKey;
	empty?: string;
}
const field = (key: string, label: string, money = false): Field => ({
	key,
	label,
	money,
	numeric: money
});
const count = (key: string, label: string): Field => ({ key, label, numeric: true });
function values(row: object, fields: Field[]): Record<string, string> {
	const raw = row as Record<string, unknown>;
	return Object.fromEntries(
		fields.map((f) => [
			f.key,
			f.money
				? screenMoney(String(raw[f.key] ?? 0))
				: f.numeric
					? formatNumber(Number(raw[f.key] ?? 0))
					: String(raw[f.key] ?? '')
		])
	);
}
const totalsOf = (row: object, fields: Field[]) => {
	const v = values(row, fields);
	const lead = ['totalValue', 'paymentsTotal', 'total', 'totalAmount', 'balance', 'bondCount'];
	return fields
		.filter((f) => f.numeric)
		.sort((a, b) => {
			const rank = (key: string) => (lead.includes(key) ? lead.indexOf(key) : lead.length);
			return rank(a.key) - rank(b.key);
		})
		.map((f) => ({ label: f.label, value: v[f.key] }));
};
const mark = (kind: StatusKind, value: string): StatusMeta =>
	(STATUS_MAP[kind] as Record<string, StatusMeta>)[value] ?? {
		tone: 'neutral',
		label: 'Otro estado'
	};
const label = (labels: Record<string, string>, value: string, fallback: string) =>
	labels[value] ?? fallback;
export const settlementLabels: Record<string, string> = {
	open: 'Abierta',
	closed: 'Cerrada',
	corrected: 'Corregida',
	annulled: 'Anulada'
};

export function operationalModel(
	data: OperationalData,
	view: string,
	collectorHref: (id: string) => string | undefined,
	saleHref: (id: string) => string | undefined
): Model {
	if (view === 'by-collector') {
		const fields = [
			field('collectorName', 'Cobrador'),
			count('bondCount', 'Bonos'),
			count('deliveredCount', 'Entregados'),
			count('soldCount', 'Vendidos'),
			count('returnedCount', 'Devueltos'),
			field('totalValue', 'Valor', true),
			field('soldValue', 'Valor vendido', true)
		];
		return {
			title: 'Bonos por cobrador',
			fields,
			rows: data.bondsByCollector.rows.map((r, i) => ({
				id: r.collectorId ?? String(i),
				values: values({ ...r, collectorName: r.collectorName ?? 'Sin asignar' }, fields),
				href: r.collectorId ? collectorHref(r.collectorId) : undefined
			})),
			totals: totalsOf(data.bondsByCollector.totals, fields),
			report: 'bonds-by-collector',
			empty: 'Ningún bono coincide con los filtros.'
		};
	}
	if (view === 'installments') {
		const fields = [
			field('collectorName', 'Cobrador'),
			...INSTALLMENT_BUCKETS.map((b) => field(b, INSTALLMENT_BUCKET_LABELS[b]))
		];
		const bucketValues = (buckets: typeof data.installments.totals) =>
			Object.fromEntries(
				INSTALLMENT_BUCKETS.map((b) => [
					b,
					`${formatNumber(buckets[b].count)} cuotas, ${screenMoney(buckets[b].amount)}`
				])
			);
		return {
			title: 'Cuotas: pendientes, pagadas, adelantadas y vencidas',
			fields,
			rows: data.installments.collectors.map((r) => ({
				id: r.collectorId,
				values: { collectorName: r.collectorName, ...bucketValues(r.buckets) },
				href: collectorHref(r.collectorId)
			})),
			totals: INSTALLMENT_BUCKETS.map((b) => ({
				label: INSTALLMENT_BUCKET_LABELS[b],
				value: bucketValues(data.installments.totals)[b]
			})),
			report: 'installments',
			empty: 'Ninguna cuota coincide con los filtros.'
		};
	}
	if (view === 'overdue-warning') {
		const n = data.overdueWarning.threshold;
		const fields = [
			field('bondLabel', 'Bono'),
			field('collectorName', 'Cobrador'),
			count('overdueCount', 'Cuotas vencidas'),
			field('overdueAmount', 'Importe vencido', true),
			field('oldestDueDate', 'Primer vencimiento')
		];
		return {
			title: `Ventas con ${n} o más ${n === 1 ? 'cuota vencida' : 'cuotas vencidas'}`,
			fields,
			rows: data.overdueWarning.sales.map((r) => ({
				id: r.saleId,
				values: values({ ...r, oldestDueDate: formatDate(r.oldestDueDate) }, fields),
				bond: r.bondLabel,
				href: saleHref(r.saleId)
			})),
			totals: [{ label: 'Ventas con mora', value: formatNumber(data.overdueWarning.sales.length) }],
			report: 'overdue-sales',
			empty: `Ninguna venta tiene ${n} o más ${n === 1 ? 'cuota vencida' : 'cuotas vencidas'}.`
		};
	}
	if (view === 'monthly') {
		const fields = [
			field('collectorName', 'Cobrador'),
			count('assignedBonds', 'Asignados'),
			count('soldBonds', 'Vendidos'),
			field('soldValue', 'Valor vendido', true),
			count('pendingInstallments', 'Cuotas pendientes'),
			field('pendingAmount', 'Importe pendiente', true),
			count('overdueInstallments', 'Cuotas vencidas'),
			field('overdueAmount', 'Importe vencido', true),
			count('paymentsCount', 'Pagos'),
			field('paymentsCash', 'Efectivo', true),
			field('paymentsTransfer', 'Transferencia', true),
			field('paymentsTotal', 'Cobrado', true)
		];
		return {
			title: `Resumen mensual por cobrador: ${formatMonthLabel(data.filters.month)}`,
			fields,
			rows: data.monthly.rows.map((r) => ({
				id: r.collectorId,
				values: values(r, fields),
				href: collectorHref(r.collectorId)
			})),
			totals: totalsOf(data.monthly.totals, fields),
			report: 'collector-monthly',
			empty: 'No hubo actividad de cobradores en este mes.'
		};
	}
	const m = data.bondsByStatus;
	const fields = [
		field('status', 'Estado comercial'),
		...m.financialStatuses.map((s) =>
			count(s, label(BOND_FINANCIAL_STATUS_LABELS, s, 'Otro estado'))
		),
		count('bondCount', 'Bonos'),
		field('totalValue', 'Valor', true)
	];
	return {
		title: 'Bonos por estado comercial y financiero',
		fields,
		rows: m.commercialStatuses.map((s) => ({
			id: s,
			marks: { status: mark('bondCommercial', s) },
			values: values(
				{
					status: label(BOND_COMMERCIAL_STATUS_LABELS, s, 'Otro estado'),
					...m.cells[s],
					...m.commercialTotals[s]
				},
				fields
			)
		})),
		totals: totalsOf(
			{ ...m.financialTotals, bondCount: m.bondCount, totalValue: m.totalValue },
			fields
		),
		report: 'bonds-by-status',
		empty: 'Ningún bono coincide con los filtros.'
	};
}

export function financialModel(
	data: FinancialData,
	view: string,
	href: (view: string, params: Record<string, string>) => string
): Model {
	if (view === 'settlements') {
		const fields = [
			field('collectorName', 'Cobrador'),
			field('status', 'Estado'),
			count('settlementCount', 'Rendiciones'),
			field('totalAmount', 'Total', true),
			field('totalCash', 'Efectivo', true),
			field('totalTransfer', 'Transferencia', true),
			field('commissionAmount', 'Comisión', true),
			field('commissionPaidAmount', 'Comisión pagada', true),
			field('netToFirefighters', 'Neto para Bomberos', true)
		];
		return {
			title: 'Rendiciones por cobrador',
			fields,
			rows: data.settlements.rows.map((r) => ({
				id: r.collectorId + r.status,
				marks: { status: mark('settlement', r.status) },
				values: values({ ...r, status: settlementLabels[r.status] ?? 'Otro estado' }, fields)
			})),
			totals: totalsOf(data.settlements.totals, fields),
			report: 'settlements-by-collector'
		};
	}
	if (view === 'accounts') {
		const fields = [
			field('collectorName', 'Cobrador'),
			count('entryCount', 'Asientos'),
			field('creditTotal', 'Créditos', true),
			field('debitTotal', 'Débitos', true),
			field('balance', 'Saldo', true),
			field('lastEntryOn', 'Último movimiento')
		];
		return {
			title: 'Cuentas de cobradores',
			fields,
			rows: data.accounts.rows.map((r) => ({
				id: r.collectorId,
				values: values({ ...r, lastEntryOn: formatDate(r.lastEntryOn) }, fields),
				href: href('ledger', { collector: r.collectorId })
			})),
			totals: totalsOf(data.accounts.totals, fields),
			report: 'collector-accounts'
		};
	}
	if (view === 'ledger') {
		const fields = [
			field('date', 'Fecha'),
			field('entryType', 'Tipo'),
			field('amount', 'Importe'),
			field('runningBalance', 'Saldo'),
			field('direction', 'Sentido'),
			field('status', 'Estado'),
			field('settlementNumber', 'Rendición'),
			field('reason', 'Motivo')
		];
		return {
			title: 'Detalle de la cuenta',
			fields,
			rows: (data.ledger ?? []).map((r) => ({
				id: r.entryId,
				marks: { status: mark('ledger', r.status) },
				values: {
					date: `${formatDate(r.occurredOn)} ${r.occurredTime}`,
					entryType:
						label(LEDGER_ENTRY_TYPE_LABELS, r.entryType, 'Movimiento') +
						(r.affectsBalance ? '' : '. Referencia: no cambia el saldo.'),
					amount: formatMoney(r.amount, { decimals: 'always' }),
					runningBalance: formatMoney(r.runningBalance, { decimals: 'always' }),
					direction: label(LEDGER_DIRECTION_LABELS, r.direction, 'Movimiento'),
					status: label(LEDGER_STATUS_LABELS, r.status, 'Otro estado'),
					settlementNumber: String(r.settlementNumber ?? ''),
					reason: r.reason ?? ''
				}
			})),
			totals: data.ledger?.length
				? [
						{
							label: 'Saldo al final del período',
							value: formatMoney(data.ledger[data.ledger.length - 1].runningBalance, {
								decimals: 'always'
							})
						}
					]
				: [],
			report: data.ledger ? 'collector-ledger' : undefined,
			empty: data.ledger
				? 'No hay asientos de cuenta en este período.'
				: 'Elegir un cobrador para ver el detalle de la cuenta.'
		};
	}
	if (view === 'rosters') {
		const fields = [
			field('drawName', 'Sorteo'),
			field('drawType', 'Tipo'),
			field('drawDate', 'Fecha'),
			field('drawStatus', 'Estado'),
			field('rosterStatus', 'Padrón'),
			count('eligibleCount', 'Elegibles'),
			count('ineligibleCount', 'No elegibles')
		];
		return {
			title: 'Padrones de sorteo',
			fields,
			rows: data.draws.map((r) => ({
				id: r.drawId,
				marks: { drawStatus: mark('draw', r.drawStatus) },
				values: values(
					{
						...r,
						drawType: drawTypeLabel(r.drawType),
						drawDate: formatDate(r.drawDate),
						drawStatus: drawStatusLabel(r.drawStatus),
						rosterStatus: r.rosterStatus ? 'Congelado' : 'No congelado'
					},
					fields
				),
				href: href('roster', { draw: r.drawId })
			})),
			totals: [{ label: 'Sorteos', value: formatNumber(data.draws.length) }],
			empty: 'Esta campaña no tiene sorteos.'
		};
	}
	if (view === 'roster') {
		const fields = [
			field('number', 'Número'),
			field('eligible', 'Elegible'),
			field('reason', 'Motivo'),
			field('buyer', 'Comprador'),
			field('collector', 'Cobrador')
		];
		return {
			title: `Números del padrón${data.selectedDraw ? `: ${data.selectedDraw.drawName}` : ''}`,
			fields,
			rows: (data.roster ?? []).map((r) => ({
				id: String(r.numberValue),
				marks: {
					eligible: { tone: r.eligible ? 'success' : 'warning', label: r.eligible ? 'Sí' : 'No' }
				},
				bond: String(r.numberValue).padStart(data.campaign.numberDigits, '0'),
				values: {
					number: String(r.numberValue),
					eligible: r.eligible ? 'Sí' : 'No',
					reason: r.ineligibilityReason ?? '',
					buyer: r.buyerName ?? '',
					collector: r.collectorName ?? ''
				}
			})),
			totals: data.selectedDraw
				? [
						{ label: 'Elegibles', value: formatNumber(data.selectedDraw.eligibleCount) },
						{ label: 'No elegibles', value: formatNumber(data.selectedDraw.ineligibleCount) }
					]
				: [],
			report: data.roster ? 'draw-roster' : undefined,
			empty: data.roster
				? 'Ningún número del padrón coincide (puede que el padrón no esté congelado).'
				: 'Elegir un sorteo para ver los números de su padrón.'
		};
	}
	if (view === 'prizes') {
		const fields = [
			field('prizeName', 'Premio'),
			field('drawName', 'Sorteo'),
			field('prizeStatus', 'Estado'),
			field('winningNumber', 'Número'),
			count('position', 'Posición'),
			field('resultStatus', 'Resultado'),
			field('buyerName', 'Comprador'),
			field('collectorName', 'Cobrador'),
			field('awardedOn', 'Adjudicado'),
			field('deliveredOn', 'Entregado')
		];
		return {
			title: 'Ganadores y premios',
			fields,
			rows: data.prizes.rows.map((r) => ({
				id: r.prizeId,
				marks: {
					prizeStatus: mark('prize', r.prizeStatus),
					...(r.resultStatus ? { resultStatus: mark('winningNumber', r.resultStatus) } : {})
				},
				values: values(
					{
						...r,
						winningNumber:
							r.winningNumber === null
								? ''
								: String(r.winningNumber).padStart(data.campaign.numberDigits, '0'),
						prizeStatus: label(PRIZE_STATUS_LABELS, r.prizeStatus, 'Otro estado'),
						resultStatus: r.resultStatus
							? label(WINNING_NUMBER_STATUS_LABELS, r.resultStatus, 'Otro resultado')
							: '',
						awardedOn: r.awardedOn ? formatDate(r.awardedOn) : '',
						deliveredOn: r.deliveredOn ? formatDate(r.deliveredOn) : ''
					},
					fields
				)
			})),
			totals: PRIZE_STATUSES.filter((s) => data.prizes.counts[s]).map((s) => ({
				label: PRIZE_STATUS_LABELS[s],
				value: formatNumber(data.prizes.counts[s])
			})),
			report: 'prizes'
		};
	}
	const fields = [
		field('paymentDate', 'Fecha'),
		field('cash', 'Efectivo', true),
		field('transfer', 'Transferencia', true),
		count('count', 'Pagos'),
		field('total', 'Total', true)
	];
	return {
		title: 'Pagos por fecha y medio de pago',
		fields,
		rows: data.payments.days.map((r) => ({
			id: r.paymentDate,
			values: values({ ...r, paymentDate: formatDate(r.paymentDate) }, fields)
		})),
		totals: totalsOf(data.payments.totals, fields),
		report: 'payments-by-date'
	};
}
