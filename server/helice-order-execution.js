import { randomUUID } from 'node:crypto';
import { transaction } from './database.js';
import { CatalogError, requireActiveProduct } from './product-catalog.js';
import { HELICE_ORDER_PREFIX } from './helice-order-store.js';

function validateAction(input) {
  const { action, requestId, version } = input ?? {};
  if (!['report', 'release'].includes(action) || typeof requestId !== 'string' || !/^[0-9a-f]{32}$/.test(requestId) ||
      !Number.isSafeInteger(version) || version < 1) {
    throw new CatalogError('Ação ou versão da OP inválida.');
  }
  const notes = String(input.notes ?? '').trim();
  if (notes.length > 500) throw new CatalogError('A observação deve ter até 500 caracteres.');
  const command = { action, requestId, version, notes };
  if (action === 'release') return command;
  const { approved, scrap, waiting } = input;
  if (![approved, scrap, waiting].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1e9)) {
    throw new CatalogError('Informe quantidades inteiras e não negativas.');
  }
  const location = String(input.location ?? '').trim();
  if (location.length > 100 || (waiting > 0 && !location)) {
    throw new CatalogError('Informe o local do estoque temporário com até 100 caracteres.');
  }
  return { ...command, approved, scrap, waiting, location: waiting ? location : '' };
}

export async function executeHeliceOrder(orderId, input, actor) {
  const command = validateAction(input);
  if (!/^[0-9a-f-]{36}$/.test(orderId) || !actor?.trim()) throw new CatalogError('Ordem ou usuário inválido.');
  return transaction(async client => {
    // A abertura também estabiliza o cadastro antes de consultar as OPs.
    await client.query('LOCK TABLE public.master_items IN SHARE ROW EXCLUSIVE MODE');
    const row = (await client.query(`SELECT key,value,version FROM public.app_state
      WHERE key LIKE 'hrn_helice_order_v1:%' AND value::jsonb->>'id'=$1 FOR UPDATE`, [orderId])).rows[0];
    if (!row) throw new CatalogError('OP não encontrada.', 'ORDER_NOT_FOUND', 404);
    const order = JSON.parse(row.value);
    const history = order.events ?? [];
    const previous = history.find(event => event.request_id === command.requestId);
    if (previous) {
      if (previous.actor !== actor || previous.command !== JSON.stringify(command)) {
        throw new CatalogError('Identificador de ação já utilizado.', 'ORDER_REQUEST_CONFLICT', 409);
      }
      return { order, idempotent: true };
    }
    if (order.version !== command.version) {
      throw new CatalogError('A OP mudou. Reabra os detalhes antes de tentar novamente.', 'ORDER_STALE', 409);
    }
    await requireActiveProduct(client, order.product_id);
    const at = new Date().toISOString();
    const event = { action: command.action, request_id: command.requestId, command: JSON.stringify(command), actor, at, notes: command.notes };
    let child;

    if (command.action === 'release') {
      if (order.status !== 'waiting') throw new CatalogError('Somente lotes em espera podem ser liberados.');
      event.location = order.waiting_location;
      order.status = 'open';
      order.waiting_location = null;
    } else {
      const stageIndex = order.completed_stage_count;
      const step = order.routing[stageIndex];
      if (order.status !== 'open' || !step) throw new CatalogError('A OP precisa estar em produção e ter uma etapa pendente.');
      const { approved, scrap, waiting, location } = command;
      if (approved + scrap + waiting !== order.remaining_quantity) {
        throw new CatalogError(`Distribua as ${order.remaining_quantity} peças entre aprovadas, refugo e espera.`);
      }
      Object.assign(event, { stage_index: stageIndex, step, approved, scrap, waiting, location });
      if (waiting) {
        const childId = randomUUID();
        const suffix = history.filter(entry => entry.child_id).length + 1;
        child = {
          id: childId, number: `${order.number}.${suffix}`, parent_id: order.id, parent_number: order.number,
          product_id: order.product_id, sku: order.sku, description: order.description, unit: order.unit,
          quantity: waiting, remaining_quantity: waiting, status: 'waiting', waiting_location: location,
          completed_stage_count: stageIndex, current_stage: step, routing: order.routing, consumption: [],
          created_by: actor, created_at: at, version: 1, events: []
        };
        Object.assign(event, { child_id: child.id, child_number: child.number });
      }
      order.completed_stage_count++;
      order.current_stage = order.routing[stageIndex + 1] ?? null;
      order.remaining_quantity = order.current_stage ? approved : 0;
      if (!approved || !order.current_stage) {
        order.status = 'completed';
        order.finished_at = at;
        order.finished_quantity = approved;
        order.remaining_quantity = 0;
        order.current_stage = null;
      }
    }

    order.version++;
    order.events = [...history, event];
    const audit = async (key, action, version, payload) => client.query(
      'INSERT INTO public.audit_log(state_key,action,version,payload,actor,created_at) VALUES($1,$2,$3,$4,$5,clock_timestamp())',
      [key, action, version, JSON.stringify(payload), actor]
    );
    await client.query('UPDATE public.app_state SET value=$2,version=$3,updated_at=clock_timestamp() WHERE key=$1',
      [row.key, JSON.stringify(order), order.version]);
    await audit(row.key, command.action === 'report' ? 'REPORT_OP_STAGE' : 'RELEASE_OP_LOT', order.version, event);
    if (child) {
      const childKey = HELICE_ORDER_PREFIX + 'child:' + child.id;
      await client.query('INSERT INTO public.app_state(key,value,version,updated_at) VALUES($1,$2,1,clock_timestamp())',
        [childKey, JSON.stringify(child)]);
      await audit(childKey, 'SPLIT_OP', 1, child);
    }
    return { order, child };
  });
}
