import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Define toOk and toErr locally if not provided by the SDK
function toOk(result: any) {
  return { ok: true, result };
}
function toErr(error: any) {
  return { ok: false, error };
}

import { BASE } from "./config";
import { http } from "./utils/http";

// ⬇️ Agora usamos ISO com offset/Z
import { toBackendISODateTime, ensureFutureISO, normalizePhone } from "./utils/normalize";

import {
  AgendarSchema,
  BuscarPorDataSchema,
  BuscarPorPeriodoSchema,
  AlterarDataSchema,
  DeletarSchema,
  type AgendarInput,
  type BuscarPorDataInput,
  type BuscarPorPeriodoInput,
  type AlterarDataInput,
  type DeletarInput,
} from "./schemas";

/** Util: garante "YYYY-MM-DD" a partir de ISO ou já-YYYY-MM-DD */
function toDayParam(s: string) {
  const trimmed = String(s).trim();
  // Se já vier só a data
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  // Se vier ISO com ou sem segundos (aqui garantimos segundos via toBackendISODateTime)
  const iso = toBackendISODateTime(trimmed);
  return iso.slice(0, 10); // YYYY-MM-DD
}

/** Cria e configura um MCP Server com as 5 tools */
export function makeMeetingsMcpServer() {
  const server = new McpServer({ name: "meetings-mcp-server", version: "1.0.0" });

  // Agendar
  server.registerTool(
    "agendar",
    {
      title: "Agendar reunião",
      description: "Cria uma nova reunião",
      inputSchema: AgendarSchema.shape,
    },
    // 1. ADICIONA O 'context'
    async (args: AgendarInput, context: any) => {
      console.log("[MCP] agendar input:", args);
      try {
        // 2. EXTRAI O TOKEN DO CONTEXT
        const token = context?.headers?.["authorization"];
        if (!token) throw new Error("Token não recebido pelo MCP Server.");

        const clienteNumero = normalizePhone(args.clienteNumero);

        // Normaliza p/ ISO com offset e valida futuro
        const dataHoraISO = toBackendISODateTime(args.dataHora);
        ensureFutureISO(dataHoraISO);

        const body = JSON.stringify({ ...args, clienteNumero, dataHora: dataHoraISO });
        const resp = await http(`${BASE}`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": token // 3. REPASSA O TOKEN
          },
          body,
        });

        console.log("[MCP] agendar resp:", resp);
        return { content: [{ type: "text", text: JSON.stringify(resp) }] };
      } catch (e: any) {
        console.error("[MCP] agendar erro:", e?.message, e?.response?.data);
        return { content: [{ type: "text", text: `❌ ${e?.message ?? "Erro ao agendar."}` }] };
      }
    }
  );

  // Buscar por data
  server.registerTool(
    "buscarPorData",
    {
      title: "Buscar por data",
      description: "Lista reuniões de um dia (YYYY-MM-DD ou ISO com offset)",
      inputSchema: BuscarPorDataSchema.shape,
    },
    // 1. ADICIONA O 'context'
    async (args: BuscarPorDataInput, context: any) => {
      console.log("[MCP] buscarPorData input:", args);
      try {
        // 2. EXTRAI O TOKEN DO CONTEXT
        const token = context?.headers?.["authorization"];
        if (!token) throw new Error("Token não recebido pelo MCP Server.");
        
        const day = toDayParam(args.day);
        const resp = await http(`${BASE}/?day=${encodeURIComponent(day)}`, { 
          method: "GET",
          headers: { "Authorization": token } // 3. REPASSA O TOKEN
        });

        console.log("[MCP] buscarPorData resp:", resp);
        return { content: [{ type: "text", text: JSON.stringify(resp) }] };
      } catch (e: any) {
        console.error("[MCP] buscarPorData erro:", e?.message, e?.response?.data);
        return { content: [{ type: "text", text: `❌ ${e?.message ?? "Erro ao buscar por data."}` }] };
      }
    }
  );


  // Buscar por período
  server.registerTool(
    "buscarPorPeriodo",
    {
      title: "Buscar por período",
      description: "Lista reuniões entre start e end (ISO completo com offset)",
      inputSchema: BuscarPorPeriodoSchema.shape,
    },
    // 1. ADICIONA O 'context'
    async (args: BuscarPorPeriodoInput, context: any) => {
      console.log("[MCP] buscarPorPeriodo input:", args);

      // helper local...
      const expandIfDateOnly = (raw: string, which: "start" | "end") => {
        const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
        if (dateOnly) {
          const suffix = which === "start" ? "T00:00:00-03:00" : "T23:59:59-03:00";
          return `${raw}${suffix}`;
        }
        return raw; // já veio ISO; mantém
      };

      try {
        // 2. EXTRAI O TOKEN DO CONTEXT
        const token = context?.headers?.["authorization"];
        if (!token) throw new Error("Token não recebido pelo MCP Server.");

        // 1) Expande (se vier YYYY-MM-DD) e normaliza p/ ISO com offset/segundos
        const startISO = toBackendISODateTime(expandIfDateOnly(args.start, "start"));
        const endISO   = toBackendISODateTime(expandIfDateOnly(args.end,   "end"));

        // 2) Validação de ordem
        if (new Date(startISO).getTime() > new Date(endISO).getTime()) {
          throw new Error("Intervalo inválido: start > end.");
        }

        // 3) Chamada real
        const url = `${BASE}/?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`;
        const resp = await http(url, { 
          method: "GET",
          headers: { "Authorization": token } // 3. REPASSA O TOKEN
        });

        console.log("[MCP] buscarPorPeriodo resp:", resp);
        return { content: [{ type: "text", text: JSON.stringify(resp) }] };
      } catch (e: any) {
        console.error("[MCP] buscarPorPeriodo erro:", e?.message, e?.response?.data);
        return { content: [{ type: "text", text: `❌ ${e?.message ?? "Erro ao buscar por período."}` }] };
      }
    }
  );

  // Alterar data/hora
  server.registerTool(
    "alterarData",
    {
      title: "Alterar data/hora",
      description: "Altera data/hora de uma reunião existente",
      inputSchema: AlterarDataSchema.shape,
    },
    // 1. ADICIONA O 'context'
    async (args: AlterarDataInput, context: any) => {
      console.log("[MCP] alterarData input:", args);
      try {
        // 2. EXTRAI O TOKEN DO CONTEXT
        const token = context?.headers?.["authorization"];
        if (!token) throw new Error("Token não recebido pelo MCP Server.");

        const novaISO = toBackendISODateTime(args.novaDataHora);
        ensureFutureISO(novaISO);

        const body = JSON.stringify({ novaDataHora: novaISO });
        const resp = await http(`${BASE}/${encodeURIComponent(args.id)}`, {
          method: "PATCH",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": token // 3. REPASSA O TOKEN
          },
          body,
        });

        console.log("[MCP] alterarData resp:", resp);
        return { content: [{ type: "text", text: JSON.stringify(resp) }] };
      } catch (e: any) {
        console.error("[MCP] alterarData erro:", e?.message, e?.response?.data);
        return { content: [{ type: "text", text: `❌ ${e?.message ?? "Erro ao alterar data."}` }] };
      }
    }
  );

  // Deletar
  server.registerTool(
    "deletar",
    {
      title: "Deletar reunião",
      description: "Remove uma reunião pelo ID",
      inputSchema: DeletarSchema.shape,
    },
    // 1. ADICIONA O 'context'
    async (args: DeletarInput, context: any) => {
      console.log("[MCP] deletar input:", args);
      try {
        // 2. EXTRAI O TOKEN DO CONTEXT
        const token = context?.headers?.["authorization"];
        if (!token) throw new Error("Token não recebido pelo MCP Server.");
        
        const resp = await http(`${BASE}/${encodeURIComponent(args.id)}`, { 
          method: "DELETE",
          headers: { "Authorization": token } // 3. REPASSA O TOKEN
        });

        console.log("[MCP] deletar resp:", resp);
        return { content: [{ type: "text", text: JSON.stringify(resp) }] };
      } catch (e: any) {
        console.error("[MCP] deletar erro:", e?.message, e?.response?.data);
        return { content: [{ type: "text", text: `❌ ${e?.message ?? "Erro ao deletar."}` }] };
      }
    }
  );

  server.registerTool(
    "check",
    {
      title: "Verificar status do backend",
      description: "Realiza uma requisição GET no endpoint /check para confirmar se o sistema está online.",
      inputSchema: {}, // sem parâmetros
    },
    // 1. ADICIONA O 'context' (e 'args: any' como placeholder)
    async (args: any, context: any) => {
      console.log("[MCP] check iniciado...");
      try {
        // 2. EXTRAI O TOKEN (opcional, pois /check pode ser pública)
        const token = context?.headers?.["authorization"];
        
        const headers: Record<string, string> = {};
        if (token) {
          headers["Authorization"] = token; // 3. REPASSA SE EXISTIR
        }

        const resp = await http(`${BASE}/check`, { 
          method: "GET",
          headers: headers 
        });
        
        console.log("[MCP] check resp:", resp);
        return { content: [{ type: "text", text: JSON.stringify(resp) }] };
      } catch (e: any) {
        console.error("[MCP] check erro:", e?.message, e?.response?.data);
        return { content: [{ type: "text", text: `❌ ${e?.message ?? "Erro ao verificar backend."}` }] };
      }
    }
  );

  return server;
}