import { defineTool } from "@deepseek-ai/dsh-tools";
import { z } from "zod";
import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
//#region lib/model.js
/**
* Canvas data model + pure state transitions. Kept dependency-light (no
* cordis / dsh-tools / react) so `tests/model.verify.ts` can exercise it
* directly under the Node strip-only verify harness, and so the Host half and
* the Client half share ONE source of truth for node/edge shape.
*/
/** Empty canvas. */
function emptyCanvas() {
	return {
		nodes: [],
		edges: []
	};
}
/** New node id. `crypto.randomUUID` exists in Node ≥ 16 and all browsers. */
function newId() {
	return crypto.randomUUID();
}
/**
* Add a node. Returns the new state and the added node (with its generated id).
* Ids are de-duped: a caller-supplied id that collides is re-minted.
*/
function addNode(state, node) {
	const id = node.id !== void 0 && node.id !== "" && !state.nodes.some((n) => n.id === node.id) ? node.id : newId();
	const added = {
		...node,
		id
	};
	return {
		state: {
			...state,
			nodes: [...state.nodes, added]
		},
		node: added
	};
}
/**
* Remove a node and every edge touching it. Idempotent: a missing id is a
* no-op returning the same state.
*/
function removeNode(state, nodeId) {
	if (!state.nodes.some((n) => n.id === nodeId)) return state;
	return {
		nodes: state.nodes.filter((n) => n.id !== nodeId),
		edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId)
	};
}
/** Add a directed edge. Both endpoints must exist, else it throws. */
function addEdge(state, edge) {
	const sourceExists = state.nodes.some((n) => n.id === edge.source);
	const targetExists = state.nodes.some((n) => n.id === edge.target);
	if (!sourceExists || !targetExists) throw new Error(`canvas_link 需要两个已存在的节点（source=${edge.source} target=${edge.target}）`);
	const id = edge.id !== void 0 && edge.id !== "" ? edge.id : newId();
	const added = {
		...edge,
		id
	};
	return {
		state: {
			...state,
			edges: [...state.edges, added]
		},
		edge: added
	};
}
/** Patch one node's mutable fields. Missing id is a no-op. */
function updateNode(state, nodeId, patch) {
	return {
		...state,
		nodes: state.nodes.map((n) => n.id === nodeId ? {
			...n,
			...patch
		} : n)
	};
}
//#endregion
//#region lib/session-compat.js
const requiredEventType = "canvas/state";
/**
* Harness generates a closed persistence vocabulary at build time. LDD owns the
* `canvas/state` event type and must register it before any profile session is
* opened, or a session log that contains it is refused on read ("… unknown to
* this harness and not marked ignorable") and the GUI reports 历史加载失败.
*
* Mirrors `@ldd/dsh-video-frame-analyzer`'s session-compat for
* `video/analysis-input`. The registration mutates the SAME Set instance the
* harness itself imported (ESM module-cache singleton), so no path-to-runtime
* resolution is needed — unlike an out-of-tree loose module.
*/
function registerCanvasSessionEvent(eventTypes) {
	if (eventTypes.has(requiredEventType)) return;
	const candidate = eventTypes;
	if (typeof candidate.add !== "function") throw new Error("Harness session event vocabulary cannot register LDD canvas persistence");
	candidate.add(requiredEventType);
	if (!eventTypes.has(requiredEventType)) throw new Error("Harness session event vocabulary rejected LDD canvas persistence");
}
//#endregion
//#region lib/remote.js
/**
* @ldd/dsh-canvas — Canvas write-back Remote service (typert remote).
*
* The host half of the canvas's bidirectional-editing path. The agent mutates
* the canvas through `canvas_*` tools; this service exposes the SAME mutations
* as typert `@Remote` verbs so the CLIENT can call them directly (drag / link /
* edit / delete) and the change lands as a durable `canvas/state` session event
* — zero agent round-trip.
*
* Every verb takes the owning session's `SessionId` as its FIRST parameter —
* the same direct (non-lookup) shape the harness `session-controller` uses
* (`prompt({ sessionId })`, `commands.execute(sessionId, …)`). The client calls
* `ctx.remote.canvas.addNode(sessionId, request)` with no scope machinery; the
* host resolves the live `Agent` through `ctx.agents.get(sessionId)` and writes
* back through `agent.session.append` — the exact seam the `canvas_*` tools
* already use, so agent and user edits share one durable mirror.
*/
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) {
			if (kind === "field") initializers.unshift(_);
			else descriptor[key] = _;
		}
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
/** Fold the current canvas state out of the session log (last `canvas/state` wins). */
function foldCanvas$1(events) {
	let state = emptyCanvas();
	for (const event of events) if (event.type === "canvas/state") state = event.data.state;
	return state;
}
let CanvasService = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _inspect_decorators;
	let _addNode_decorators;
	let _removeNode_decorators;
	let _updateNode_decorators;
	let _moveNode_decorators;
	let _link_decorators;
	let _saveAsset_decorators;
	return class CanvasService extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_inspect_decorators = [Remote("inspect")];
			_addNode_decorators = [Remote("addNode")];
			_removeNode_decorators = [Remote("removeNode")];
			_updateNode_decorators = [Remote("updateNode")];
			_moveNode_decorators = [Remote("moveNode")];
			_link_decorators = [Remote("link")];
			_saveAsset_decorators = [Remote("saveAsset")];
			__esDecorate(this, null, _inspect_decorators, {
				kind: "method",
				name: "inspect",
				static: false,
				private: false,
				access: {
					has: (obj) => "inspect" in obj,
					get: (obj) => obj.inspect
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _addNode_decorators, {
				kind: "method",
				name: "addNode",
				static: false,
				private: false,
				access: {
					has: (obj) => "addNode" in obj,
					get: (obj) => obj.addNode
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _removeNode_decorators, {
				kind: "method",
				name: "removeNode",
				static: false,
				private: false,
				access: {
					has: (obj) => "removeNode" in obj,
					get: (obj) => obj.removeNode
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _updateNode_decorators, {
				kind: "method",
				name: "updateNode",
				static: false,
				private: false,
				access: {
					has: (obj) => "updateNode" in obj,
					get: (obj) => obj.updateNode
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _moveNode_decorators, {
				kind: "method",
				name: "moveNode",
				static: false,
				private: false,
				access: {
					has: (obj) => "moveNode" in obj,
					get: (obj) => obj.moveNode
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _link_decorators, {
				kind: "method",
				name: "link",
				static: false,
				private: false,
				access: {
					has: (obj) => "link" in obj,
					get: (obj) => obj.link
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _saveAsset_decorators, {
				kind: "method",
				name: "saveAsset",
				static: false,
				private: false,
				access: {
					has: (obj) => "saveAsset" in obj,
					get: (obj) => obj.saveAsset
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		static inject = ["attachments", "sessions"];
		constructor(ctx) {
			super(ctx, "canvas");
			__runInitializers(this, _instanceExtraInitializers);
		}
		/** Resolve the live Session owning a session id (the canvas write-back seam). */
		sessionOf(sessionId) {
			const session = this.ctx.sessions.get(sessionId);
			if (session === void 0) throw new Error(`canvas: 会话不可用 (${String(sessionId)})`);
			return session;
		}
		/** Read the whole canvas. */
		inspect(sessionId) {
			return foldCanvas$1(this.sessionOf(sessionId).snapshotEvents());
		}
		/** Add a node; returns the full new canvas (the client re-renders from it). */
		addNode(sessionId, request) {
			const session = this.sessionOf(sessionId);
			const before = foldCanvas$1(session.snapshotEvents());
			const auto = before.nodes.length;
			const { state: next } = addNode(before, {
				...request.id === void 0 ? {} : { id: request.id },
				kind: request.kind,
				label: request.label,
				x: typeof request.x === "number" ? request.x : auto % 4 * 220,
				y: typeof request.y === "number" ? request.y : Math.floor(auto / 4) * 180,
				...request.content === void 0 ? {} : { content: request.content },
				...request.url === void 0 ? {} : { url: request.url },
				...request.meta === void 0 ? {} : { meta: request.meta }
			});
			session.append("canvas/state", { state: next });
			return next;
		}
		/** Remove a node (and its touching edges); returns the full new canvas. */
		removeNode(sessionId, nodeId) {
			const session = this.sessionOf(sessionId);
			const next = removeNode(foldCanvas$1(session.snapshotEvents()), nodeId);
			session.append("canvas/state", { state: next });
			return next;
		}
		/** Patch one node's mutable fields; returns the full new canvas. */
		updateNode(sessionId, nodeId, patch) {
			const session = this.sessionOf(sessionId);
			const next = updateNode(foldCanvas$1(session.snapshotEvents()), nodeId, {
				...patch.label === void 0 ? {} : { label: patch.label },
				...patch.x === void 0 ? {} : { x: patch.x },
				...patch.y === void 0 ? {} : { y: patch.y },
				...patch.content === void 0 ? {} : { content: patch.content },
				...patch.meta === void 0 ? {} : { meta: patch.meta }
			});
			session.append("canvas/state", { state: next });
			return next;
		}
		/** Move a node (position-only convenience; returns the full new canvas). */
		moveNode(sessionId, nodeId, x, y) {
			const session = this.sessionOf(sessionId);
			const next = updateNode(foldCanvas$1(session.snapshotEvents()), nodeId, {
				x,
				y
			});
			session.append("canvas/state", { state: next });
			return next;
		}
		/** Link two nodes; returns the full new canvas. */
		link(sessionId, request) {
			const session = this.sessionOf(sessionId);
			const { state: next } = addEdge(foldCanvas$1(session.snapshotEvents()), {
				source: request.source,
				target: request.target,
				...request.label === void 0 ? {} : { label: request.label }
			});
			session.append("canvas/state", { state: next });
			return next;
		}
		/** Store one user-uploaded asset durably (image → normalized via `saveImage`,
		*  video/audio → verbatim via `saveFile`); returns its content-addressed
		*  attachment id (+ normalized image size). The client stores the id as the
		*  node's `url` so `loadImage` can read it back. */
		async saveAsset(sessionId, request) {
			this.sessionOf(sessionId);
			const attachments = this.ctx.attachments;
			if (attachments === void 0) throw new Error("canvas: 附件存储不可用");
			const binary = atob(request.dataBase64);
			const data = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
			if (request.kind === "image") {
				if (request.mediaType === void 0) throw new Error("canvas: 图片上传缺少媒体类型");
				const ref = await attachments.saveImage({
					data,
					mediaType: request.mediaType,
					name: request.name
				});
				return {
					attachmentId: ref.attachmentId,
					width: ref.width,
					height: ref.height
				};
			}
			return { attachmentId: (await attachments.saveFile({
				data,
				name: request.name
			})).attachmentId };
		}
	};
})();
//#endregion
//#region lib/index.js
const name = "ldd-canvas";
const inject = [
	"tools",
	"sessions",
	"attachments"
];
registerCanvasSessionEvent(KNOWN_SESSION_EVENT_TYPES);
const canvasNodeSchema = z.object({
	id: z.string(),
	kind: z.enum([
		"image",
		"video",
		"music",
		"text",
		"note"
	]),
	label: z.string(),
	x: z.number(),
	y: z.number(),
	attachmentId: z.string().optional(),
	url: z.string().optional(),
	meta: z.record(z.string(), z.any()).optional(),
	content: z.string().optional()
});
const canvasEdgeSchema = z.object({
	id: z.string(),
	source: z.string(),
	target: z.string(),
	label: z.string().optional()
});
const canvasStateSchema = z.object({
	nodes: z.array(canvasNodeSchema),
	edges: z.array(canvasEdgeSchema)
});
const NODE_KINDS = [
	"image",
	"video",
	"music",
	"text",
	"note"
];
const KIND_LABEL = {
	image: "图片",
	video: "视频",
	music: "音乐",
	text: "文本",
	note: "笔记"
};
const inspectOutputSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		nodes: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: {
						type: "string",
						required: true
					},
					kind: {
						type: "string",
						required: true
					},
					label: {
						type: "string",
						required: true
					},
					x: {
						type: "number",
						required: true
					},
					y: {
						type: "number",
						required: true
					},
					attachmentId: { type: "string" },
					url: { type: "string" },
					meta: { type: "json" },
					content: { type: "string" }
				}
			}
		},
		edges: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: {
						type: "string",
						required: true
					},
					source: {
						type: "string",
						required: true
					},
					target: {
						type: "string",
						required: true
					},
					label: { type: "string" }
				}
			}
		},
		summary: {
			type: "string",
			required: true
		}
	}
};
/** Fold the current canvas state out of the session log (last `canvas/state` wins). */
function foldCanvas(events) {
	let state = emptyCanvas();
	for (const event of events) if (event.type === "canvas/state") state = event.data.state;
	return state;
}
/** Serialize one canvas for the model-facing inspect result. */
function describeCanvas(state) {
	if (state.nodes.length === 0) return "画布当前为空。";
	const nodes = state.nodes.map((n) => {
		const meta = n.meta === void 0 || Object.keys(n.meta).length === 0 ? "" : ` ${JSON.stringify(n.meta)}`;
		const extra = n.kind === "text" || n.kind === "note" ? n.content === void 0 ? "" : ` 内容="${n.content.slice(0, 80)}"` : "";
		return `  - [${n.id}] ${KIND_LABEL[n.kind]} "${n.label}" @(${n.x},${n.y})${meta}${extra}`;
	}).join("\n");
	const edges = state.edges.length === 0 ? "（无连线）" : "\n" + state.edges.map((e) => `  - [${e.id}] ${e.source} -> ${e.target}${e.label === void 0 ? "" : ` (${e.label})`}`).join("\n");
	return `画布节点（${state.nodes.length}）：\n${nodes}\n连线（${state.edges.length}）：${edges}`;
}
/** The session driving the calling tool; missing = headless / no session. */
function sessionOf(exec) {
	return exec.agent?.session;
}
function defineCanvasTools() {
	const requireSession = (exec) => {
		const session = sessionOf(exec);
		if (session === void 0) throw new Error("canvas 工具需要当前会话（无法确定会话身份）");
		return session;
	};
	return [
		defineTool({
			name: "canvas_inspect",
			description: "读取当前会话画布的全部内容：有哪些节点（图片/视频/音乐/文本/笔记）、每个节点的元数据和位置、节点之间的连线关系。调用此工具了解画布上已有的素材与依赖，再做后续操作。",
			parameters: {},
			output: {
				schema: inspectOutputSchema,
				render: (_args, value) => [{
					type: "text",
					text: value.summary
				}]
			},
			isConcurrencySafe: () => true,
			async execute(_args, exec) {
				const state = foldCanvas(requireSession(exec).snapshotEvents());
				return {
					nodes: state.nodes,
					edges: state.edges,
					summary: describeCanvas(state)
				};
			}
		}),
		defineTool({
			name: "canvas_add_node",
			description: "在画布上新增一个节点。用于把素材（图片/视频/音乐）或文字/笔记组织到画布上，供后续参考或连线。返回新节点的 id。",
			parameters: {
				kind: {
					type: "string",
					enum: [...NODE_KINDS],
					required: true,
					description: "节点类型：image=图片, video=视频, music=音乐, text=文本, note=笔记。"
				},
				label: {
					type: "string",
					required: true,
					description: "节点显示标题。"
				},
				x: {
					type: "number",
					description: "画布横坐标（可选，缺省自动布局）。"
				},
				y: {
					type: "number",
					description: "画布纵坐标（可选，缺省自动布局）。"
				},
				content: {
					type: "string",
					description: "文本/笔记节点的内容。"
				},
				url: {
					type: "string",
					description: "素材节点的 URL（图片/视频/音乐直链）。"
				},
				meta: {
					type: "object",
					additionalProperties: true,
					description: "素材元数据，如 {width,height} 或 {durationSeconds,aspectRatio}。"
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						nodeId: {
							type: "string",
							required: true
						},
						label: {
							type: "string",
							required: true
						}
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: `已在画布新增节点「${value.label}」（id=${value.nodeId}）。`
				}]
			},
			isConcurrencySafe: () => true,
			async execute(args, exec) {
				const session = requireSession(exec);
				const state = foldCanvas(session.snapshotEvents());
				const auto = state.nodes.length;
				const { state: next } = addNode(state, {
					kind: args.kind,
					label: args.label,
					x: typeof args.x === "number" ? args.x : auto % 4 * 220,
					y: typeof args.y === "number" ? args.y : Math.floor(auto / 4) * 180,
					...args.content === void 0 ? {} : { content: args.content },
					...args.url === void 0 ? {} : { url: args.url },
					...args.meta === void 0 ? {} : { meta: args.meta }
				});
				session.append("canvas/state", { state: next });
				const added = next.nodes[next.nodes.length - 1];
				return {
					nodeId: added.id,
					label: added.label
				};
			}
		}),
		defineTool({
			name: "canvas_remove_node",
			description: "从画布删除一个节点（连同与它相连的所有连线）。",
			parameters: { nodeId: {
				type: "string",
				required: true,
				description: "要删除的节点 id。"
			} },
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: { removed: {
						type: "boolean",
						required: true
					} }
				},
				render: (_args, value) => [{
					type: "text",
					text: value.removed ? "已从画布删除该节点。" : "未找到该节点，画布无变化。"
				}]
			},
			isConcurrencySafe: () => true,
			async execute(args, exec) {
				const session = requireSession(exec);
				const before = foldCanvas(session.snapshotEvents());
				const next = removeNode(before, args.nodeId);
				session.append("canvas/state", { state: next });
				return { removed: next.nodes.length !== before.nodes.length };
			}
		}),
		defineTool({
			name: "canvas_update_node",
			description: "修改画布上已有节点的标题、位置或元数据。",
			parameters: {
				nodeId: {
					type: "string",
					required: true,
					description: "要修改的节点 id。"
				},
				label: {
					type: "string",
					description: "新的显示标题。"
				},
				x: {
					type: "number",
					description: "新的横坐标。"
				},
				y: {
					type: "number",
					description: "新的纵坐标。"
				},
				content: {
					type: "string",
					description: "新的文本/笔记内容。"
				},
				meta: {
					type: "object",
					additionalProperties: true,
					description: "新的元数据。"
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: { updated: {
						type: "boolean",
						required: true
					} }
				},
				render: (_args, value) => [{
					type: "text",
					text: value.updated ? "已更新该节点。" : "未找到该节点。"
				}]
			},
			isConcurrencySafe: () => true,
			async execute(args, exec) {
				const session = requireSession(exec);
				const before = foldCanvas(session.snapshotEvents());
				const patch = {};
				if (typeof args.label === "string") patch.label = args.label;
				if (typeof args.x === "number") patch.x = args.x;
				if (typeof args.y === "number") patch.y = args.y;
				if (typeof args.content === "string") patch.content = args.content;
				if (args.meta !== void 0 && typeof args.meta === "object") patch.meta = args.meta;
				const next = updateNode(before, args.nodeId, patch);
				session.append("canvas/state", { state: next });
				return { updated: next !== before };
			}
		}),
		defineTool({
			name: "canvas_link",
			description: "在画布两个节点之间加一条连线，表达关系（如「参考」「依赖」「派生自」）。",
			parameters: {
				source: {
					type: "string",
					required: true,
					description: "源节点 id。"
				},
				target: {
					type: "string",
					required: true,
					description: "目标节点 id。"
				},
				label: {
					type: "string",
					description: "关系说明（可选）。"
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: { edgeId: {
						type: "string",
						required: true
					} }
				},
				render: (_args, value) => [{
					type: "text",
					text: `已连线（id=${value.edgeId}）。`
				}]
			},
			isConcurrencySafe: () => true,
			async execute(args, exec) {
				const session = requireSession(exec);
				const { state: next, edge } = addEdge(foldCanvas(session.snapshotEvents()), {
					source: args.source,
					target: args.target,
					...args.label === void 0 ? {} : { label: args.label }
				});
				session.append("canvas/state", { state: next });
				return { edgeId: edge.id };
			}
		})
	];
}
function apply(ctx) {
	ctx.inject(["sessionProjections"], (projectionCtx) => {
		projectionCtx.sessionProjections.register({
			key: "canvas",
			stateSchema: canvasStateSchema,
			init: emptyCanvas,
			apply: (state, event) => event.type === "canvas/state" ? event.data.state : state,
			wire: {
				viewSchema: canvasStateSchema,
				view: (state) => state
			},
			stateVersion: 1
		});
	});
	const disposers = defineCanvasTools().map((tool) => ctx.tools.register(tool));
	ctx.effect(() => () => {
		for (const dispose of disposers) dispose();
	}, "ldd-canvas: dispose tools");
	new CanvasService(ctx);
}
//#endregion
export { CanvasService, apply, inject, name };
