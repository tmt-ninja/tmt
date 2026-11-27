//#region \0rolldown/runtime.js
var e = (e, t) => () => (t || (e((t = { exports: {} }).exports, t), e = null), t.exports), t = /* @__PURE__ */ e(((e) => {
	var t = Symbol.for("react.transitional.element"), n = Symbol.for("react.portal"), r = Symbol.for("react.fragment"), i = Symbol.for("react.strict_mode"), a = Symbol.for("react.profiler"), o = Symbol.for("react.consumer"), s = Symbol.for("react.context"), c = Symbol.for("react.forward_ref"), l = Symbol.for("react.suspense"), u = Symbol.for("react.memo"), d = Symbol.for("react.lazy"), f = Symbol.for("react.activity"), p = Symbol.iterator;
	function m(e) {
		return typeof e != "object" || !e ? null : (e = p && e[p] || e["@@iterator"], typeof e == "function" ? e : null);
	}
	var h = {
		isMounted: function() {
			return !1;
		},
		enqueueForceUpdate: function() {},
		enqueueReplaceState: function() {},
		enqueueSetState: function() {}
	}, g = Object.assign, _ = {};
	function v(e, t, n) {
		this.props = e, this.context = t, this.refs = _, this.updater = n || h;
	}
	v.prototype.isReactComponent = {}, v.prototype.setState = function(e, t) {
		if (typeof e != "object" && typeof e != "function" && e != null) throw Error("takes an object of state variables to update or a function which returns an object of state variables.");
		this.updater.enqueueSetState(this, e, t, "setState");
	}, v.prototype.forceUpdate = function(e) {
		this.updater.enqueueForceUpdate(this, e, "forceUpdate");
	};
	function y() {}
	y.prototype = v.prototype;
	function b(e, t, n) {
		this.props = e, this.context = t, this.refs = _, this.updater = n || h;
	}
	var x = b.prototype = new y();
	x.constructor = b, g(x, v.prototype), x.isPureReactComponent = !0;
	var S = Array.isArray;
	function C() {}
	var w = {
		H: null,
		A: null,
		T: null,
		S: null
	}, ee = Object.prototype.hasOwnProperty;
	function te(e, n, r) {
		var i = r.ref;
		return {
			$$typeof: t,
			type: e,
			key: n,
			ref: i === void 0 ? null : i,
			props: r
		};
	}
	function ne(e, t) {
		return te(e.type, t, e.props);
	}
	function re(e) {
		return typeof e == "object" && !!e && e.$$typeof === t;
	}
	function ie(e) {
		var t = {
			"=": "=0",
			":": "=2"
		};
		return "$" + e.replace(/[=:]/g, function(e) {
			return t[e];
		});
	}
	var ae = /\/+/g;
	function oe(e, t) {
		return typeof e == "object" && e && e.key != null ? ie("" + e.key) : t.toString(36);
	}
	function se(e) {
		switch (e.status) {
			case "fulfilled": return e.value;
			case "rejected": throw e.reason;
			default: switch (typeof e.status == "string" ? e.then(C, C) : (e.status = "pending", e.then(function(t) {
				e.status === "pending" && (e.status = "fulfilled", e.value = t);
			}, function(t) {
				e.status === "pending" && (e.status = "rejected", e.reason = t);
			})), e.status) {
				case "fulfilled": return e.value;
				case "rejected": throw e.reason;
			}
		}
		throw e;
	}
	function ce(e, r, i, a, o) {
		var s = typeof e;
		(s === "undefined" || s === "boolean") && (e = null);
		var c = !1;
		if (e === null) c = !0;
		else switch (s) {
			case "bigint":
			case "string":
			case "number":
				c = !0;
				break;
			case "object": switch (e.$$typeof) {
				case t:
				case n:
					c = !0;
					break;
				case d: return c = e._init, ce(c(e._payload), r, i, a, o);
			}
		}
		if (c) return o = o(e), c = a === "" ? "." + oe(e, 0) : a, S(o) ? (i = "", c != null && (i = c.replace(ae, "$&/") + "/"), ce(o, r, i, "", function(e) {
			return e;
		})) : o != null && (re(o) && (o = ne(o, i + (o.key == null || e && e.key === o.key ? "" : ("" + o.key).replace(ae, "$&/") + "/") + c)), r.push(o)), 1;
		c = 0;
		var l = a === "" ? "." : a + ":";
		if (S(e)) for (var u = 0; u < e.length; u++) a = e[u], s = l + oe(a, u), c += ce(a, r, i, s, o);
		else if (u = m(e), typeof u == "function") for (e = u.call(e), u = 0; !(a = e.next()).done;) a = a.value, s = l + oe(a, u++), c += ce(a, r, i, s, o);
		else if (s === "object") {
			if (typeof e.then == "function") return ce(se(e), r, i, a, o);
			throw r = String(e), Error("Objects are not valid as a React child (found: " + (r === "[object Object]" ? "object with keys {" + Object.keys(e).join(", ") + "}" : r) + "). If you meant to render a collection of children, use an array instead.");
		}
		return c;
	}
	function T(e, t, n) {
		if (e == null) return e;
		var r = [], i = 0;
		return ce(e, r, "", "", function(e) {
			return t.call(n, e, i++);
		}), r;
	}
	function le(e) {
		if (e._status === -1) {
			var t = e._result;
			t = t(), t.then(function(t) {
				(e._status === 0 || e._status === -1) && (e._status = 1, e._result = t);
			}, function(t) {
				(e._status === 0 || e._status === -1) && (e._status = 2, e._result = t);
			}), e._status === -1 && (e._status = 0, e._result = t);
		}
		if (e._status === 1) return e._result.default;
		throw e._result;
	}
	var E = typeof reportError == "function" ? reportError : function(e) {
		if (typeof window == "object" && typeof window.ErrorEvent == "function") {
			var t = new window.ErrorEvent("error", {
				bubbles: !0,
				cancelable: !0,
				message: typeof e == "object" && e && typeof e.message == "string" ? String(e.message) : String(e),
				error: e
			});
			if (!window.dispatchEvent(t)) return;
		} else if (typeof process == "object" && typeof process.emit == "function") {
			process.emit("uncaughtException", e);
			return;
		}
		console.error(e);
	}, D = {
		map: T,
		forEach: function(e, t, n) {
			T(e, function() {
				t.apply(this, arguments);
			}, n);
		},
		count: function(e) {
			var t = 0;
			return T(e, function() {
				t++;
			}), t;
		},
		toArray: function(e) {
			return T(e, function(e) {
				return e;
			}) || [];
		},
		only: function(e) {
			if (!re(e)) throw Error("React.Children.only expected to receive a single React element child.");
			return e;
		}
	};
	e.Activity = f, e.Children = D, e.Component = v, e.Fragment = r, e.Profiler = a, e.PureComponent = b, e.StrictMode = i, e.Suspense = l, e.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = w, e.__COMPILER_RUNTIME = {
		__proto__: null,
		c: function(e) {
			return w.H.useMemoCache(e);
		}
	}, e.cache = function(e) {
		return function() {
			return e.apply(null, arguments);
		};
	}, e.cacheSignal = function() {
		return null;
	}, e.cloneElement = function(e, t, n) {
		if (e == null) throw Error("The argument must be a React element, but you passed " + e + ".");
		var r = g({}, e.props), i = e.key;
		if (t != null) for (a in t.key !== void 0 && (i = "" + t.key), t) !ee.call(t, a) || a === "key" || a === "__self" || a === "__source" || a === "ref" && t.ref === void 0 || (r[a] = t[a]);
		var a = arguments.length - 2;
		if (a === 1) r.children = n;
		else if (1 < a) {
			for (var o = Array(a), s = 0; s < a; s++) o[s] = arguments[s + 2];
			r.children = o;
		}
		return te(e.type, i, r);
	}, e.createContext = function(e) {
		return e = {
			$$typeof: s,
			_currentValue: e,
			_currentValue2: e,
			_threadCount: 0,
			Provider: null,
			Consumer: null
		}, e.Provider = e, e.Consumer = {
			$$typeof: o,
			_context: e
		}, e;
	}, e.createElement = function(e, t, n) {
		var r, i = {}, a = null;
		if (t != null) for (r in t.key !== void 0 && (a = "" + t.key), t) ee.call(t, r) && r !== "key" && r !== "__self" && r !== "__source" && (i[r] = t[r]);
		var o = arguments.length - 2;
		if (o === 1) i.children = n;
		else if (1 < o) {
			for (var s = Array(o), c = 0; c < o; c++) s[c] = arguments[c + 2];
			i.children = s;
		}
		if (e && e.defaultProps) for (r in o = e.defaultProps, o) i[r] === void 0 && (i[r] = o[r]);
		return te(e, a, i);
	}, e.createRef = function() {
		return { current: null };
	}, e.forwardRef = function(e) {
		return {
			$$typeof: c,
			render: e
		};
	}, e.isValidElement = re, e.lazy = function(e) {
		return {
			$$typeof: d,
			_payload: {
				_status: -1,
				_result: e
			},
			_init: le
		};
	}, e.memo = function(e, t) {
		return {
			$$typeof: u,
			type: e,
			compare: t === void 0 ? null : t
		};
	}, e.startTransition = function(e) {
		var t = w.T, n = {};
		w.T = n;
		try {
			var r = e(), i = w.S;
			i !== null && i(n, r), typeof r == "object" && r && typeof r.then == "function" && r.then(C, E);
		} catch (e) {
			E(e);
		} finally {
			t !== null && n.types !== null && (t.types = n.types), w.T = t;
		}
	}, e.unstable_useCacheRefresh = function() {
		return w.H.useCacheRefresh();
	}, e.use = function(e) {
		return w.H.use(e);
	}, e.useActionState = function(e, t, n) {
		return w.H.useActionState(e, t, n);
	}, e.useCallback = function(e, t) {
		return w.H.useCallback(e, t);
	}, e.useContext = function(e) {
		return w.H.useContext(e);
	}, e.useDebugValue = function() {}, e.useDeferredValue = function(e, t) {
		return w.H.useDeferredValue(e, t);
	}, e.useEffect = function(e, t) {
		return w.H.useEffect(e, t);
	}, e.useEffectEvent = function(e) {
		return w.H.useEffectEvent(e);
	}, e.useId = function() {
		return w.H.useId();
	}, e.useImperativeHandle = function(e, t, n) {
		return w.H.useImperativeHandle(e, t, n);
	}, e.useInsertionEffect = function(e, t) {
		return w.H.useInsertionEffect(e, t);
	}, e.useLayoutEffect = function(e, t) {
		return w.H.useLayoutEffect(e, t);
	}, e.useMemo = function(e, t) {
		return w.H.useMemo(e, t);
	}, e.useOptimistic = function(e, t) {
		return w.H.useOptimistic(e, t);
	}, e.useReducer = function(e, t, n) {
		return w.H.useReducer(e, t, n);
	}, e.useRef = function(e) {
		return w.H.useRef(e);
	}, e.useState = function(e) {
		return w.H.useState(e);
	}, e.useSyncExternalStore = function(e, t, n) {
		return w.H.useSyncExternalStore(e, t, n);
	}, e.useTransition = function() {
		return w.H.useTransition();
	}, e.version = "19.2.8";
})), n = /* @__PURE__ */ e(((e, n) => {
	n.exports = t();
})), r = /* @__PURE__ */ e(((e) => {
	function t(e, t) {
		var n = e.length;
		e.push(t);
		a: for (; 0 < n;) {
			var r = n - 1 >>> 1, a = e[r];
			if (0 < i(a, t)) e[r] = t, e[n] = a, n = r;
			else break a;
		}
	}
	function n(e) {
		return e.length === 0 ? null : e[0];
	}
	function r(e) {
		if (e.length === 0) return null;
		var t = e[0], n = e.pop();
		if (n !== t) {
			e[0] = n;
			a: for (var r = 0, a = e.length, o = a >>> 1; r < o;) {
				var s = 2 * (r + 1) - 1, c = e[s], l = s + 1, u = e[l];
				if (0 > i(c, n)) l < a && 0 > i(u, c) ? (e[r] = u, e[l] = n, r = l) : (e[r] = c, e[s] = n, r = s);
				else if (l < a && 0 > i(u, n)) e[r] = u, e[l] = n, r = l;
				else break a;
			}
		}
		return t;
	}
	function i(e, t) {
		var n = e.sortIndex - t.sortIndex;
		return n === 0 ? e.id - t.id : n;
	}
	if (e.unstable_now = void 0, typeof performance == "object" && typeof performance.now == "function") {
		var a = performance;
		e.unstable_now = function() {
			return a.now();
		};
	} else {
		var o = Date, s = o.now();
		e.unstable_now = function() {
			return o.now() - s;
		};
	}
	var c = [], l = [], u = 1, d = null, f = 3, p = !1, m = !1, h = !1, g = !1, _ = typeof setTimeout == "function" ? setTimeout : null, v = typeof clearTimeout == "function" ? clearTimeout : null, y = typeof setImmediate < "u" ? setImmediate : null;
	function b(e) {
		for (var i = n(l); i !== null;) {
			if (i.callback === null) r(l);
			else if (i.startTime <= e) r(l), i.sortIndex = i.expirationTime, t(c, i);
			else break;
			i = n(l);
		}
	}
	function x(e) {
		if (h = !1, b(e), !m) {
			if (n(c) !== null) m = !0, S || (S = !0, re());
			else {
				var t = n(l);
				t !== null && oe(x, t.startTime - e);
			}
		}
	}
	var S = !1, C = -1, w = 5, ee = -1;
	function te() {
		return g ? !0 : !(e.unstable_now() - ee < w);
	}
	function ne() {
		if (g = !1, S) {
			var t = e.unstable_now();
			ee = t;
			var i = !0;
			try {
				a: {
					m = !1, h && (h = !1, v(C), C = -1), p = !0;
					var a = f;
					try {
						b: {
							for (b(t), d = n(c); d !== null && !(d.expirationTime > t && te());) {
								var o = d.callback;
								if (typeof o == "function") {
									d.callback = null, f = d.priorityLevel;
									var s = o(d.expirationTime <= t);
									if (t = e.unstable_now(), typeof s == "function") {
										d.callback = s, b(t), i = !0;
										break b;
									}
									d === n(c) && r(c), b(t);
								} else r(c);
								d = n(c);
							}
							if (d !== null) i = !0;
							else {
								var u = n(l);
								u !== null && oe(x, u.startTime - t), i = !1;
							}
						}
						break a;
					} finally {
						d = null, f = a, p = !1;
					}
					i = void 0;
				}
			} finally {
				i ? re() : S = !1;
			}
		}
	}
	var re;
	if (typeof y == "function") re = function() {
		y(ne);
	};
	else if (typeof MessageChannel < "u") {
		var ie = new MessageChannel(), ae = ie.port2;
		ie.port1.onmessage = ne, re = function() {
			ae.postMessage(null);
		};
	} else re = function() {
		_(ne, 0);
	};
	function oe(t, n) {
		C = _(function() {
			t(e.unstable_now());
		}, n);
	}
	e.unstable_IdlePriority = 5, e.unstable_ImmediatePriority = 1, e.unstable_LowPriority = 4, e.unstable_NormalPriority = 3, e.unstable_Profiling = null, e.unstable_UserBlockingPriority = 2, e.unstable_cancelCallback = function(e) {
		e.callback = null;
	}, e.unstable_forceFrameRate = function(e) {
		0 > e || 125 < e ? console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported") : w = 0 < e ? Math.floor(1e3 / e) : 5;
	}, e.unstable_getCurrentPriorityLevel = function() {
		return f;
	}, e.unstable_next = function(e) {
		switch (f) {
			case 1:
			case 2:
			case 3:
				var t = 3;
				break;
			default: t = f;
		}
		var n = f;
		f = t;
		try {
			return e();
		} finally {
			f = n;
		}
	}, e.unstable_requestPaint = function() {
		g = !0;
	}, e.unstable_runWithPriority = function(e, t) {
		switch (e) {
			case 1:
			case 2:
			case 3:
			case 4:
			case 5: break;
			default: e = 3;
		}
		var n = f;
		f = e;
		try {
			return t();
		} finally {
			f = n;
		}
	}, e.unstable_scheduleCallback = function(r, i, a) {
		var o = e.unstable_now();
		switch (typeof a == "object" && a ? (a = a.delay, a = typeof a == "number" && 0 < a ? o + a : o) : a = o, r) {
			case 1:
				var s = -1;
				break;
			case 2:
				s = 250;
				break;
			case 5:
				s = 1073741823;
				break;
			case 4:
				s = 1e4;
				break;
			default: s = 5e3;
		}
		return s = a + s, r = {
			id: u++,
			callback: i,
			priorityLevel: r,
			startTime: a,
			expirationTime: s,
			sortIndex: -1
		}, a > o ? (r.sortIndex = a, t(l, r), n(c) === null && r === n(l) && (h ? (v(C), C = -1) : h = !0, oe(x, a - o))) : (r.sortIndex = s, t(c, r), m || p || (m = !0, S || (S = !0, re()))), r;
	}, e.unstable_shouldYield = te, e.unstable_wrapCallback = function(e) {
		var t = f;
		return function() {
			var n = f;
			f = t;
			try {
				return e.apply(this, arguments);
			} finally {
				f = n;
			}
		};
	};
})), i = /* @__PURE__ */ e(((e, t) => {
	t.exports = r();
})), a = /* @__PURE__ */ e(((e) => {
	var t = n();
	function r(e) {
		var t = "https://react.dev/errors/" + e;
		if (1 < arguments.length) {
			t += "?args[]=" + encodeURIComponent(arguments[1]);
			for (var n = 2; n < arguments.length; n++) t += "&args[]=" + encodeURIComponent(arguments[n]);
		}
		return "Minified React error #" + e + "; visit " + t + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
	}
	function i() {}
	var a = {
		d: {
			f: i,
			r: function() {
				throw Error(r(522));
			},
			D: i,
			C: i,
			L: i,
			m: i,
			X: i,
			S: i,
			M: i
		},
		p: 0,
		findDOMNode: null
	}, o = Symbol.for("react.portal");
	function s(e, t, n) {
		var r = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
		return {
			$$typeof: o,
			key: r == null ? null : "" + r,
			children: e,
			containerInfo: t,
			implementation: n
		};
	}
	var c = t.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
	function l(e, t) {
		if (e === "font") return "";
		if (typeof t == "string") return t === "use-credentials" ? t : "";
	}
	e.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = a, e.createPortal = function(e, t) {
		var n = 2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
		if (!t || t.nodeType !== 1 && t.nodeType !== 9 && t.nodeType !== 11) throw Error(r(299));
		return s(e, t, null, n);
	}, e.flushSync = function(e) {
		var t = c.T, n = a.p;
		try {
			if (c.T = null, a.p = 2, e) return e();
		} finally {
			c.T = t, a.p = n, a.d.f();
		}
	}, e.preconnect = function(e, t) {
		typeof e == "string" && (t ? (t = t.crossOrigin, t = typeof t == "string" ? t === "use-credentials" ? t : "" : void 0) : t = null, a.d.C(e, t));
	}, e.prefetchDNS = function(e) {
		typeof e == "string" && a.d.D(e);
	}, e.preinit = function(e, t) {
		if (typeof e == "string" && t && typeof t.as == "string") {
			var n = t.as, r = l(n, t.crossOrigin), i = typeof t.integrity == "string" ? t.integrity : void 0, o = typeof t.fetchPriority == "string" ? t.fetchPriority : void 0;
			n === "style" ? a.d.S(e, typeof t.precedence == "string" ? t.precedence : void 0, {
				crossOrigin: r,
				integrity: i,
				fetchPriority: o
			}) : n === "script" && a.d.X(e, {
				crossOrigin: r,
				integrity: i,
				fetchPriority: o,
				nonce: typeof t.nonce == "string" ? t.nonce : void 0
			});
		}
	}, e.preinitModule = function(e, t) {
		if (typeof e == "string") {
			if (typeof t == "object" && t) {
				if (t.as == null || t.as === "script") {
					var n = l(t.as, t.crossOrigin);
					a.d.M(e, {
						crossOrigin: n,
						integrity: typeof t.integrity == "string" ? t.integrity : void 0,
						nonce: typeof t.nonce == "string" ? t.nonce : void 0
					});
				}
			} else t ?? a.d.M(e);
		}
	}, e.preload = function(e, t) {
		if (typeof e == "string" && typeof t == "object" && t && typeof t.as == "string") {
			var n = t.as, r = l(n, t.crossOrigin);
			a.d.L(e, n, {
				crossOrigin: r,
				integrity: typeof t.integrity == "string" ? t.integrity : void 0,
				nonce: typeof t.nonce == "string" ? t.nonce : void 0,
				type: typeof t.type == "string" ? t.type : void 0,
				fetchPriority: typeof t.fetchPriority == "string" ? t.fetchPriority : void 0,
				referrerPolicy: typeof t.referrerPolicy == "string" ? t.referrerPolicy : void 0,
				imageSrcSet: typeof t.imageSrcSet == "string" ? t.imageSrcSet : void 0,
				imageSizes: typeof t.imageSizes == "string" ? t.imageSizes : void 0,
				media: typeof t.media == "string" ? t.media : void 0
			});
		}
	}, e.preloadModule = function(e, t) {
		if (typeof e == "string") {
			if (t) {
				var n = l(t.as, t.crossOrigin);
				a.d.m(e, {
					as: typeof t.as == "string" && t.as !== "script" ? t.as : void 0,
					crossOrigin: n,
					integrity: typeof t.integrity == "string" ? t.integrity : void 0
				});
			} else a.d.m(e);
		}
	}, e.requestFormReset = function(e) {
		a.d.r(e);
	}, e.unstable_batchedUpdates = function(e, t) {
		return e(t);
	}, e.useFormState = function(e, t, n) {
		return c.H.useFormState(e, t, n);
	}, e.useFormStatus = function() {
		return c.H.useHostTransitionStatus();
	}, e.version = "19.2.8";
})), o = /* @__PURE__ */ e(((e, t) => {
	function n() {
		if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE == "function") try {
			__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n);
		} catch (e) {
			console.error(e);
		}
	}
	n(), t.exports = a();
})), s = /* @__PURE__ */ e(((e) => {
	var t = i(), r = n(), a = o();
	function s(e) {
		var t = "https://react.dev/errors/" + e;
		if (1 < arguments.length) {
			t += "?args[]=" + encodeURIComponent(arguments[1]);
			for (var n = 2; n < arguments.length; n++) t += "&args[]=" + encodeURIComponent(arguments[n]);
		}
		return "Minified React error #" + e + "; visit " + t + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
	}
	function c(e) {
		return !(!e || e.nodeType !== 1 && e.nodeType !== 9 && e.nodeType !== 11);
	}
	function l(e) {
		var t = e, n = e;
		if (e.alternate) for (; t.return;) t = t.return;
		else {
			e = t;
			do
				t = e, t.flags & 4098 && (n = t.return), e = t.return;
			while (e);
		}
		return t.tag === 3 ? n : null;
	}
	function u(e) {
		if (e.tag === 13) {
			var t = e.memoizedState;
			if (t === null && (e = e.alternate, e !== null && (t = e.memoizedState)), t !== null) return t.dehydrated;
		}
		return null;
	}
	function d(e) {
		if (e.tag === 31) {
			var t = e.memoizedState;
			if (t === null && (e = e.alternate, e !== null && (t = e.memoizedState)), t !== null) return t.dehydrated;
		}
		return null;
	}
	function f(e) {
		if (l(e) !== e) throw Error(s(188));
	}
	function p(e) {
		var t = e.alternate;
		if (!t) {
			if (t = l(e), t === null) throw Error(s(188));
			return t === e ? e : null;
		}
		for (var n = e, r = t;;) {
			var i = n.return;
			if (i === null) break;
			var a = i.alternate;
			if (a === null) {
				if (r = i.return, r !== null) {
					n = r;
					continue;
				}
				break;
			}
			if (i.child === a.child) {
				for (a = i.child; a;) {
					if (a === n) return f(i), e;
					if (a === r) return f(i), t;
					a = a.sibling;
				}
				throw Error(s(188));
			}
			if (n.return !== r.return) n = i, r = a;
			else {
				for (var o = !1, c = i.child; c;) {
					if (c === n) {
						o = !0, n = i, r = a;
						break;
					}
					if (c === r) {
						o = !0, r = i, n = a;
						break;
					}
					c = c.sibling;
				}
				if (!o) {
					for (c = a.child; c;) {
						if (c === n) {
							o = !0, n = a, r = i;
							break;
						}
						if (c === r) {
							o = !0, r = a, n = i;
							break;
						}
						c = c.sibling;
					}
					if (!o) throw Error(s(189));
				}
			}
			if (n.alternate !== r) throw Error(s(190));
		}
		if (n.tag !== 3) throw Error(s(188));
		return n.stateNode.current === n ? e : t;
	}
	function m(e) {
		var t = e.tag;
		if (t === 5 || t === 26 || t === 27 || t === 6) return e;
		for (e = e.child; e !== null;) {
			if (t = m(e), t !== null) return t;
			e = e.sibling;
		}
		return null;
	}
	var h = Object.assign, g = Symbol.for("react.element"), _ = Symbol.for("react.transitional.element"), v = Symbol.for("react.portal"), y = Symbol.for("react.fragment"), b = Symbol.for("react.strict_mode"), x = Symbol.for("react.profiler"), S = Symbol.for("react.consumer"), C = Symbol.for("react.context"), w = Symbol.for("react.forward_ref"), ee = Symbol.for("react.suspense"), te = Symbol.for("react.suspense_list"), ne = Symbol.for("react.memo"), re = Symbol.for("react.lazy"), ie = Symbol.for("react.activity"), ae = Symbol.for("react.memo_cache_sentinel"), oe = Symbol.iterator;
	function se(e) {
		return typeof e != "object" || !e ? null : (e = oe && e[oe] || e["@@iterator"], typeof e == "function" ? e : null);
	}
	var ce = Symbol.for("react.client.reference");
	function T(e) {
		if (e == null) return null;
		if (typeof e == "function") return e.$$typeof === ce ? null : e.displayName || e.name || null;
		if (typeof e == "string") return e;
		switch (e) {
			case y: return "Fragment";
			case x: return "Profiler";
			case b: return "StrictMode";
			case ee: return "Suspense";
			case te: return "SuspenseList";
			case ie: return "Activity";
		}
		if (typeof e == "object") switch (e.$$typeof) {
			case v: return "Portal";
			case C: return e.displayName || "Context";
			case S: return (e._context.displayName || "Context") + ".Consumer";
			case w:
				var t = e.render;
				return e = e.displayName, e ||= (e = t.displayName || t.name || "", e === "" ? "ForwardRef" : "ForwardRef(" + e + ")"), e;
			case ne: return t = e.displayName || null, t === null ? T(e.type) || "Memo" : t;
			case re:
				t = e._payload, e = e._init;
				try {
					return T(e(t));
				} catch {}
		}
		return null;
	}
	var le = Array.isArray, E = r.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, D = a.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, ue = {
		pending: !1,
		data: null,
		method: null,
		action: null
	}, de = [], fe = -1;
	function pe(e) {
		return { current: e };
	}
	function me(e) {
		0 > fe || (e.current = de[fe], de[fe] = null, fe--);
	}
	function O(e, t) {
		fe++, de[fe] = e.current, e.current = t;
	}
	var he = pe(null), ge = pe(null), _e = pe(null), ve = pe(null);
	function ye(e, t) {
		switch (O(_e, t), O(ge, e), O(he, null), t.nodeType) {
			case 9:
			case 11:
				e = (e = t.documentElement) && (e = e.namespaceURI) ? Vd(e) : 0;
				break;
			default: if (e = t.tagName, t = t.namespaceURI) t = Vd(t), e = Hd(t, e);
			else switch (e) {
				case "svg":
					e = 1;
					break;
				case "math":
					e = 2;
					break;
				default: e = 0;
			}
		}
		me(he), O(he, e);
	}
	function be() {
		me(he), me(ge), me(_e);
	}
	function xe(e) {
		e.memoizedState !== null && O(ve, e);
		var t = he.current, n = Hd(t, e.type);
		t !== n && (O(ge, e), O(he, n));
	}
	function Se(e) {
		ge.current === e && (me(he), me(ge)), ve.current === e && (me(ve), Qf._currentValue = ue);
	}
	var Ce, we;
	function Te(e) {
		if (Ce === void 0) try {
			throw Error();
		} catch (e) {
			var t = e.stack.trim().match(/\n( *(at )?)/);
			Ce = t && t[1] || "", we = -1 < e.stack.indexOf("\n    at") ? " (<anonymous>)" : -1 < e.stack.indexOf("@") ? "@unknown:0:0" : "";
		}
		return "\n" + Ce + e + we;
	}
	var Ee = !1;
	function De(e, t) {
		if (!e || Ee) return "";
		Ee = !0;
		var n = Error.prepareStackTrace;
		Error.prepareStackTrace = void 0;
		try {
			var r = { DetermineComponentFrameRoot: function() {
				try {
					if (t) {
						var n = function() {
							throw Error();
						};
						if (Object.defineProperty(n.prototype, "props", { set: function() {
							throw Error();
						} }), typeof Reflect == "object" && Reflect.construct) {
							try {
								Reflect.construct(n, []);
							} catch (e) {
								var r = e;
							}
							Reflect.construct(e, [], n);
						} else {
							try {
								n.call();
							} catch (e) {
								r = e;
							}
							e.call(n.prototype);
						}
					} else {
						try {
							throw Error();
						} catch (e) {
							r = e;
						}
						(n = e()) && typeof n.catch == "function" && n.catch(function() {});
					}
				} catch (e) {
					if (e && r && typeof e.stack == "string") return [e.stack, r.stack];
				}
				return [null, null];
			} };
			r.DetermineComponentFrameRoot.displayName = "DetermineComponentFrameRoot";
			var i = Object.getOwnPropertyDescriptor(r.DetermineComponentFrameRoot, "name");
			i && i.configurable && Object.defineProperty(r.DetermineComponentFrameRoot, "name", { value: "DetermineComponentFrameRoot" });
			var a = r.DetermineComponentFrameRoot(), o = a[0], s = a[1];
			if (o && s) {
				var c = o.split("\n"), l = s.split("\n");
				for (i = r = 0; r < c.length && !c[r].includes("DetermineComponentFrameRoot");) r++;
				for (; i < l.length && !l[i].includes("DetermineComponentFrameRoot");) i++;
				if (r === c.length || i === l.length) for (r = c.length - 1, i = l.length - 1; 1 <= r && 0 <= i && c[r] !== l[i];) i--;
				for (; 1 <= r && 0 <= i; r--, i--) if (c[r] !== l[i]) {
					if (r !== 1 || i !== 1) do
						if (r--, i--, 0 > i || c[r] !== l[i]) {
							var u = "\n" + c[r].replace(" at new ", " at ");
							return e.displayName && u.includes("<anonymous>") && (u = u.replace("<anonymous>", e.displayName)), u;
						}
					while (1 <= r && 0 <= i);
					break;
				}
			}
		} finally {
			Ee = !1, Error.prepareStackTrace = n;
		}
		return (n = e ? e.displayName || e.name : "") ? Te(n) : "";
	}
	function Oe(e, t) {
		switch (e.tag) {
			case 26:
			case 27:
			case 5: return Te(e.type);
			case 16: return Te("Lazy");
			case 13: return e.child !== t && t !== null ? Te("Suspense Fallback") : Te("Suspense");
			case 19: return Te("SuspenseList");
			case 0:
			case 15: return De(e.type, !1);
			case 11: return De(e.type.render, !1);
			case 1: return De(e.type, !0);
			case 31: return Te("Activity");
			default: return "";
		}
	}
	function ke(e) {
		try {
			var t = "", n = null;
			do
				t += Oe(e, n), n = e, e = e.return;
			while (e);
			return t;
		} catch (e) {
			return "\nError generating stack: " + e.message + "\n" + e.stack;
		}
	}
	var Ae = Object.prototype.hasOwnProperty, je = t.unstable_scheduleCallback, Me = t.unstable_cancelCallback, Ne = t.unstable_shouldYield, Pe = t.unstable_requestPaint, Fe = t.unstable_now, Ie = t.unstable_getCurrentPriorityLevel, Le = t.unstable_ImmediatePriority, Re = t.unstable_UserBlockingPriority, ze = t.unstable_NormalPriority, Be = t.unstable_LowPriority, Ve = t.unstable_IdlePriority, He = t.log, Ue = t.unstable_setDisableYieldValue, We = null, Ge = null;
	function Ke(e) {
		if (typeof He == "function" && Ue(e), Ge && typeof Ge.setStrictMode == "function") try {
			Ge.setStrictMode(We, e);
		} catch {}
	}
	var qe = Math.clz32 ? Math.clz32 : Xe, Je = Math.log, Ye = Math.LN2;
	function Xe(e) {
		return e >>>= 0, e === 0 ? 32 : 31 - (Je(e) / Ye | 0) | 0;
	}
	var Ze = 256, Qe = 262144, $e = 4194304;
	function et(e) {
		var t = e & 42;
		if (t !== 0) return t;
		switch (e & -e) {
			case 1: return 1;
			case 2: return 2;
			case 4: return 4;
			case 8: return 8;
			case 16: return 16;
			case 32: return 32;
			case 64: return 64;
			case 128: return 128;
			case 256:
			case 512:
			case 1024:
			case 2048:
			case 4096:
			case 8192:
			case 16384:
			case 32768:
			case 65536:
			case 131072: return e & 261888;
			case 262144:
			case 524288:
			case 1048576:
			case 2097152: return e & 3932160;
			case 4194304:
			case 8388608:
			case 16777216:
			case 33554432: return e & 62914560;
			case 67108864: return 67108864;
			case 134217728: return 134217728;
			case 268435456: return 268435456;
			case 536870912: return 536870912;
			case 1073741824: return 0;
			default: return e;
		}
	}
	function tt(e, t, n) {
		var r = e.pendingLanes;
		if (r === 0) return 0;
		var i = 0, a = e.suspendedLanes, o = e.pingedLanes;
		e = e.warmLanes;
		var s = r & 134217727;
		return s === 0 ? (s = r & ~a, s === 0 ? o === 0 ? n || (n = r & ~e, n !== 0 && (i = et(n))) : i = et(o) : i = et(s)) : (r = s & ~a, r === 0 ? (o &= s, o === 0 ? n || (n = s & ~e, n !== 0 && (i = et(n))) : i = et(o)) : i = et(r)), i === 0 ? 0 : t !== 0 && t !== i && (t & a) === 0 && (a = i & -i, n = t & -t, a >= n || a === 32 && n & 4194048) ? t : i;
	}
	function nt(e, t) {
		return (e.pendingLanes & ~(e.suspendedLanes & ~e.pingedLanes) & t) === 0;
	}
	function rt(e, t) {
		switch (e) {
			case 1:
			case 2:
			case 4:
			case 8:
			case 64: return t + 250;
			case 16:
			case 32:
			case 128:
			case 256:
			case 512:
			case 1024:
			case 2048:
			case 4096:
			case 8192:
			case 16384:
			case 32768:
			case 65536:
			case 131072:
			case 262144:
			case 524288:
			case 1048576:
			case 2097152: return t + 5e3;
			case 4194304:
			case 8388608:
			case 16777216:
			case 33554432: return -1;
			case 67108864:
			case 134217728:
			case 268435456:
			case 536870912:
			case 1073741824: return -1;
			default: return -1;
		}
	}
	function it() {
		var e = $e;
		return $e <<= 1, !($e & 62914560) && ($e = 4194304), e;
	}
	function at(e) {
		for (var t = [], n = 0; 31 > n; n++) t.push(e);
		return t;
	}
	function ot(e, t) {
		e.pendingLanes |= t, t !== 268435456 && (e.suspendedLanes = 0, e.pingedLanes = 0, e.warmLanes = 0);
	}
	function st(e, t, n, r, i, a) {
		var o = e.pendingLanes;
		e.pendingLanes = n, e.suspendedLanes = 0, e.pingedLanes = 0, e.warmLanes = 0, e.expiredLanes &= n, e.entangledLanes &= n, e.errorRecoveryDisabledLanes &= n, e.shellSuspendCounter = 0;
		var s = e.entanglements, c = e.expirationTimes, l = e.hiddenUpdates;
		for (n = o & ~n; 0 < n;) {
			var u = 31 - qe(n), d = 1 << u;
			s[u] = 0, c[u] = -1;
			var f = l[u];
			if (f !== null) for (l[u] = null, u = 0; u < f.length; u++) {
				var p = f[u];
				p !== null && (p.lane &= -536870913);
			}
			n &= ~d;
		}
		r !== 0 && ct(e, r, 0), a !== 0 && i === 0 && e.tag !== 0 && (e.suspendedLanes |= a & ~(o & ~t));
	}
	function ct(e, t, n) {
		e.pendingLanes |= t, e.suspendedLanes &= ~t;
		var r = 31 - qe(t);
		e.entangledLanes |= t, e.entanglements[r] = e.entanglements[r] | 1073741824 | n & 261930;
	}
	function lt(e, t) {
		var n = e.entangledLanes |= t;
		for (e = e.entanglements; n;) {
			var r = 31 - qe(n), i = 1 << r;
			i & t | e[r] & t && (e[r] |= t), n &= ~i;
		}
	}
	function ut(e, t) {
		var n = t & -t;
		return n = n & 42 ? 1 : dt(n), (n & (e.suspendedLanes | t)) === 0 ? n : 0;
	}
	function dt(e) {
		switch (e) {
			case 2:
				e = 1;
				break;
			case 8:
				e = 4;
				break;
			case 32:
				e = 16;
				break;
			case 256:
			case 512:
			case 1024:
			case 2048:
			case 4096:
			case 8192:
			case 16384:
			case 32768:
			case 65536:
			case 131072:
			case 262144:
			case 524288:
			case 1048576:
			case 2097152:
			case 4194304:
			case 8388608:
			case 16777216:
			case 33554432:
				e = 128;
				break;
			case 268435456:
				e = 134217728;
				break;
			default: e = 0;
		}
		return e;
	}
	function ft(e) {
		return e &= -e, 2 < e ? 8 < e ? e & 134217727 ? 32 : 268435456 : 8 : 2;
	}
	function pt() {
		var e = D.p;
		return e === 0 ? (e = window.event, e === void 0 ? 32 : mp(e.type)) : e;
	}
	function mt(e, t) {
		var n = D.p;
		try {
			return D.p = e, t();
		} finally {
			D.p = n;
		}
	}
	var ht = Math.random().toString(36).slice(2), gt = "__reactFiber$" + ht, _t = "__reactProps$" + ht, vt = "__reactContainer$" + ht, yt = "__reactEvents$" + ht, bt = "__reactListeners$" + ht, xt = "__reactHandles$" + ht, St = "__reactResources$" + ht, Ct = "__reactMarker$" + ht;
	function wt(e) {
		delete e[gt], delete e[_t], delete e[yt], delete e[bt], delete e[xt];
	}
	function Tt(e) {
		var t = e[gt];
		if (t) return t;
		for (var n = e.parentNode; n;) {
			if (t = n[vt] || n[gt]) {
				if (n = t.alternate, t.child !== null || n !== null && n.child !== null) for (e = df(e); e !== null;) {
					if (n = e[gt]) return n;
					e = df(e);
				}
				return t;
			}
			e = n, n = e.parentNode;
		}
		return null;
	}
	function Et(e) {
		if (e = e[gt] || e[vt]) {
			var t = e.tag;
			if (t === 5 || t === 6 || t === 13 || t === 31 || t === 26 || t === 27 || t === 3) return e;
		}
		return null;
	}
	function Dt(e) {
		var t = e.tag;
		if (t === 5 || t === 26 || t === 27 || t === 6) return e.stateNode;
		throw Error(s(33));
	}
	function Ot(e) {
		var t = e[St];
		return t ||= e[St] = {
			hoistableStyles: /* @__PURE__ */ new Map(),
			hoistableScripts: /* @__PURE__ */ new Map()
		}, t;
	}
	function kt(e) {
		e[Ct] = !0;
	}
	var At = /* @__PURE__ */ new Set(), jt = {};
	function Mt(e, t) {
		Nt(e, t), Nt(e + "Capture", t);
	}
	function Nt(e, t) {
		for (jt[e] = t, e = 0; e < t.length; e++) At.add(t[e]);
	}
	var Pt = RegExp("^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$"), Ft = {}, It = {};
	function Lt(e) {
		return Ae.call(It, e) ? !0 : Ae.call(Ft, e) ? !1 : Pt.test(e) ? It[e] = !0 : (Ft[e] = !0, !1);
	}
	function Rt(e, t, n) {
		if (Lt(t)) {
			if (n === null) e.removeAttribute(t);
			else {
				switch (typeof n) {
					case "undefined":
					case "function":
					case "symbol":
						e.removeAttribute(t);
						return;
					case "boolean":
						var r = t.toLowerCase().slice(0, 5);
						if (r !== "data-" && r !== "aria-") {
							e.removeAttribute(t);
							return;
						}
				}
				e.setAttribute(t, "" + n);
			}
		}
	}
	function zt(e, t, n) {
		if (n === null) e.removeAttribute(t);
		else {
			switch (typeof n) {
				case "undefined":
				case "function":
				case "symbol":
				case "boolean":
					e.removeAttribute(t);
					return;
			}
			e.setAttribute(t, "" + n);
		}
	}
	function Bt(e, t, n, r) {
		if (r === null) e.removeAttribute(n);
		else {
			switch (typeof r) {
				case "undefined":
				case "function":
				case "symbol":
				case "boolean":
					e.removeAttribute(n);
					return;
			}
			e.setAttributeNS(t, n, "" + r);
		}
	}
	function Vt(e) {
		switch (typeof e) {
			case "bigint":
			case "boolean":
			case "number":
			case "string":
			case "undefined": return e;
			case "object": return e;
			default: return "";
		}
	}
	function Ht(e) {
		var t = e.type;
		return (e = e.nodeName) && e.toLowerCase() === "input" && (t === "checkbox" || t === "radio");
	}
	function Ut(e, t, n) {
		var r = Object.getOwnPropertyDescriptor(e.constructor.prototype, t);
		if (!e.hasOwnProperty(t) && r !== void 0 && typeof r.get == "function" && typeof r.set == "function") {
			var i = r.get, a = r.set;
			return Object.defineProperty(e, t, {
				configurable: !0,
				get: function() {
					return i.call(this);
				},
				set: function(e) {
					n = "" + e, a.call(this, e);
				}
			}), Object.defineProperty(e, t, { enumerable: r.enumerable }), {
				getValue: function() {
					return n;
				},
				setValue: function(e) {
					n = "" + e;
				},
				stopTracking: function() {
					e._valueTracker = null, delete e[t];
				}
			};
		}
	}
	function Wt(e) {
		if (!e._valueTracker) {
			var t = Ht(e) ? "checked" : "value";
			e._valueTracker = Ut(e, t, "" + e[t]);
		}
	}
	function Gt(e) {
		if (!e) return !1;
		var t = e._valueTracker;
		if (!t) return !0;
		var n = t.getValue(), r = "";
		return e && (r = Ht(e) ? e.checked ? "true" : "false" : e.value), e = r, e !== n && (t.setValue(e), !0);
	}
	function Kt(e) {
		if (e ||= typeof document < "u" ? document : void 0, e === void 0) return null;
		try {
			return e.activeElement || e.body;
		} catch {
			return e.body;
		}
	}
	var qt = /[\n"\\]/g;
	function Jt(e) {
		return e.replace(qt, function(e) {
			return "\\" + e.charCodeAt(0).toString(16) + " ";
		});
	}
	function Yt(e, t, n, r, i, a, o, s) {
		e.name = "", o != null && typeof o != "function" && typeof o != "symbol" && typeof o != "boolean" ? e.type = o : e.removeAttribute("type"), t == null ? o !== "submit" && o !== "reset" || e.removeAttribute("value") : o === "number" ? (t === 0 && e.value === "" || e.value != t) && (e.value = "" + Vt(t)) : e.value !== "" + Vt(t) && (e.value = "" + Vt(t)), t == null ? n == null ? r != null && e.removeAttribute("value") : Zt(e, o, Vt(n)) : Zt(e, o, Vt(t)), i == null && a != null && (e.defaultChecked = !!a), i != null && (e.checked = i && typeof i != "function" && typeof i != "symbol"), s != null && typeof s != "function" && typeof s != "symbol" && typeof s != "boolean" ? e.name = "" + Vt(s) : e.removeAttribute("name");
	}
	function Xt(e, t, n, r, i, a, o, s) {
		if (a != null && typeof a != "function" && typeof a != "symbol" && typeof a != "boolean" && (e.type = a), t != null || n != null) {
			if (!(a !== "submit" && a !== "reset" || t != null)) {
				Wt(e);
				return;
			}
			n = n == null ? "" : "" + Vt(n), t = t == null ? n : "" + Vt(t), s || t === e.value || (e.value = t), e.defaultValue = t;
		}
		r ??= i, r = typeof r != "function" && typeof r != "symbol" && !!r, e.checked = s ? e.checked : !!r, e.defaultChecked = !!r, o != null && typeof o != "function" && typeof o != "symbol" && typeof o != "boolean" && (e.name = o), Wt(e);
	}
	function Zt(e, t, n) {
		t === "number" && Kt(e.ownerDocument) === e || e.defaultValue === "" + n || (e.defaultValue = "" + n);
	}
	function Qt(e, t, n, r) {
		if (e = e.options, t) {
			t = {};
			for (var i = 0; i < n.length; i++) t["$" + n[i]] = !0;
			for (n = 0; n < e.length; n++) i = t.hasOwnProperty("$" + e[n].value), e[n].selected !== i && (e[n].selected = i), i && r && (e[n].defaultSelected = !0);
		} else {
			for (n = "" + Vt(n), t = null, i = 0; i < e.length; i++) {
				if (e[i].value === n) {
					e[i].selected = !0, r && (e[i].defaultSelected = !0);
					return;
				}
				t !== null || e[i].disabled || (t = e[i]);
			}
			t !== null && (t.selected = !0);
		}
	}
	function $t(e, t, n) {
		if (t != null && (t = "" + Vt(t), t !== e.value && (e.value = t), n == null)) {
			e.defaultValue !== t && (e.defaultValue = t);
			return;
		}
		e.defaultValue = n == null ? "" : "" + Vt(n);
	}
	function en(e, t, n, r) {
		if (t == null) {
			if (r != null) {
				if (n != null) throw Error(s(92));
				if (le(r)) {
					if (1 < r.length) throw Error(s(93));
					r = r[0];
				}
				n = r;
			}
			n ??= "", t = n;
		}
		n = Vt(t), e.defaultValue = n, r = e.textContent, r === n && r !== "" && r !== null && (e.value = r), Wt(e);
	}
	function tn(e, t) {
		if (t) {
			var n = e.firstChild;
			if (n && n === e.lastChild && n.nodeType === 3) {
				n.nodeValue = t;
				return;
			}
		}
		e.textContent = t;
	}
	var nn = new Set("animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(" "));
	function rn(e, t, n) {
		var r = t.indexOf("--") === 0;
		n == null || typeof n == "boolean" || n === "" ? r ? e.setProperty(t, "") : t === "float" ? e.cssFloat = "" : e[t] = "" : r ? e.setProperty(t, n) : typeof n != "number" || n === 0 || nn.has(t) ? t === "float" ? e.cssFloat = n : e[t] = ("" + n).trim() : e[t] = n + "px";
	}
	function an(e, t, n) {
		if (t != null && typeof t != "object") throw Error(s(62));
		if (e = e.style, n != null) {
			for (var r in n) !n.hasOwnProperty(r) || t != null && t.hasOwnProperty(r) || (r.indexOf("--") === 0 ? e.setProperty(r, "") : r === "float" ? e.cssFloat = "" : e[r] = "");
			for (var i in t) r = t[i], t.hasOwnProperty(i) && n[i] !== r && rn(e, i, r);
		} else for (var a in t) t.hasOwnProperty(a) && rn(e, a, t[a]);
	}
	function on(e) {
		if (e.indexOf("-") === -1) return !1;
		switch (e) {
			case "annotation-xml":
			case "color-profile":
			case "font-face":
			case "font-face-src":
			case "font-face-uri":
			case "font-face-format":
			case "font-face-name":
			case "missing-glyph": return !1;
			default: return !0;
		}
	}
	var sn = /* @__PURE__ */ new Map([
		["acceptCharset", "accept-charset"],
		["htmlFor", "for"],
		["httpEquiv", "http-equiv"],
		["crossOrigin", "crossorigin"],
		["accentHeight", "accent-height"],
		["alignmentBaseline", "alignment-baseline"],
		["arabicForm", "arabic-form"],
		["baselineShift", "baseline-shift"],
		["capHeight", "cap-height"],
		["clipPath", "clip-path"],
		["clipRule", "clip-rule"],
		["colorInterpolation", "color-interpolation"],
		["colorInterpolationFilters", "color-interpolation-filters"],
		["colorProfile", "color-profile"],
		["colorRendering", "color-rendering"],
		["dominantBaseline", "dominant-baseline"],
		["enableBackground", "enable-background"],
		["fillOpacity", "fill-opacity"],
		["fillRule", "fill-rule"],
		["floodColor", "flood-color"],
		["floodOpacity", "flood-opacity"],
		["fontFamily", "font-family"],
		["fontSize", "font-size"],
		["fontSizeAdjust", "font-size-adjust"],
		["fontStretch", "font-stretch"],
		["fontStyle", "font-style"],
		["fontVariant", "font-variant"],
		["fontWeight", "font-weight"],
		["glyphName", "glyph-name"],
		["glyphOrientationHorizontal", "glyph-orientation-horizontal"],
		["glyphOrientationVertical", "glyph-orientation-vertical"],
		["horizAdvX", "horiz-adv-x"],
		["horizOriginX", "horiz-origin-x"],
		["imageRendering", "image-rendering"],
		["letterSpacing", "letter-spacing"],
		["lightingColor", "lighting-color"],
		["markerEnd", "marker-end"],
		["markerMid", "marker-mid"],
		["markerStart", "marker-start"],
		["overlinePosition", "overline-position"],
		["overlineThickness", "overline-thickness"],
		["paintOrder", "paint-order"],
		["panose-1", "panose-1"],
		["pointerEvents", "pointer-events"],
		["renderingIntent", "rendering-intent"],
		["shapeRendering", "shape-rendering"],
		["stopColor", "stop-color"],
		["stopOpacity", "stop-opacity"],
		["strikethroughPosition", "strikethrough-position"],
		["strikethroughThickness", "strikethrough-thickness"],
		["strokeDasharray", "stroke-dasharray"],
		["strokeDashoffset", "stroke-dashoffset"],
		["strokeLinecap", "stroke-linecap"],
		["strokeLinejoin", "stroke-linejoin"],
		["strokeMiterlimit", "stroke-miterlimit"],
		["strokeOpacity", "stroke-opacity"],
		["strokeWidth", "stroke-width"],
		["textAnchor", "text-anchor"],
		["textDecoration", "text-decoration"],
		["textRendering", "text-rendering"],
		["transformOrigin", "transform-origin"],
		["underlinePosition", "underline-position"],
		["underlineThickness", "underline-thickness"],
		["unicodeBidi", "unicode-bidi"],
		["unicodeRange", "unicode-range"],
		["unitsPerEm", "units-per-em"],
		["vAlphabetic", "v-alphabetic"],
		["vHanging", "v-hanging"],
		["vIdeographic", "v-ideographic"],
		["vMathematical", "v-mathematical"],
		["vectorEffect", "vector-effect"],
		["vertAdvY", "vert-adv-y"],
		["vertOriginX", "vert-origin-x"],
		["vertOriginY", "vert-origin-y"],
		["wordSpacing", "word-spacing"],
		["writingMode", "writing-mode"],
		["xmlnsXlink", "xmlns:xlink"],
		["xHeight", "x-height"]
	]), cn = /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
	function ln(e) {
		return cn.test("" + e) ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')" : e;
	}
	function un() {}
	var k = null;
	function dn(e) {
		return e = e.target || e.srcElement || window, e.correspondingUseElement && (e = e.correspondingUseElement), e.nodeType === 3 ? e.parentNode : e;
	}
	var A = null, fn = null;
	function pn(e) {
		var t = Et(e);
		if (t && (e = t.stateNode)) {
			var n = e[_t] || null;
			a: switch (e = t.stateNode, t.type) {
				case "input":
					if (Yt(e, n.value, n.defaultValue, n.defaultValue, n.checked, n.defaultChecked, n.type, n.name), t = n.name, n.type === "radio" && t != null) {
						for (n = e; n.parentNode;) n = n.parentNode;
						for (n = n.querySelectorAll("input[name=\"" + Jt("" + t) + "\"][type=\"radio\"]"), t = 0; t < n.length; t++) {
							var r = n[t];
							if (r !== e && r.form === e.form) {
								var i = r[_t] || null;
								if (!i) throw Error(s(90));
								Yt(r, i.value, i.defaultValue, i.defaultValue, i.checked, i.defaultChecked, i.type, i.name);
							}
						}
						for (t = 0; t < n.length; t++) r = n[t], r.form === e.form && Gt(r);
					}
					break a;
				case "textarea":
					$t(e, n.value, n.defaultValue);
					break a;
				case "select": t = n.value, t != null && Qt(e, !!n.multiple, t, !1);
			}
		}
	}
	var mn = !1;
	function hn(e, t, n) {
		if (mn) return e(t, n);
		mn = !0;
		try {
			return e(t);
		} finally {
			if (mn = !1, (A !== null || fn !== null) && (xu(), A && (t = A, e = fn, fn = A = null, pn(t), e))) for (t = 0; t < e.length; t++) pn(e[t]);
		}
	}
	function gn(e, t) {
		var n = e.stateNode;
		if (n === null) return null;
		var r = n[_t] || null;
		if (r === null) return null;
		n = r[t];
		a: switch (t) {
			case "onClick":
			case "onClickCapture":
			case "onDoubleClick":
			case "onDoubleClickCapture":
			case "onMouseDown":
			case "onMouseDownCapture":
			case "onMouseMove":
			case "onMouseMoveCapture":
			case "onMouseUp":
			case "onMouseUpCapture":
			case "onMouseEnter":
				(r = !r.disabled) || (e = e.type, r = e !== "button" && e !== "input" && e !== "select" && e !== "textarea"), e = !r;
				break a;
			default: e = !1;
		}
		if (e) return null;
		if (n && typeof n != "function") throw Error(s(231, t, typeof n));
		return n;
	}
	var _n = typeof window < "u" && window.document !== void 0 && window.document.createElement !== void 0, vn = !1;
	if (_n) try {
		var yn = {};
		Object.defineProperty(yn, "passive", { get: function() {
			vn = !0;
		} }), window.addEventListener("test", yn, yn), window.removeEventListener("test", yn, yn);
	} catch {
		vn = !1;
	}
	var bn = null, xn = null, Sn = null;
	function Cn() {
		if (Sn) return Sn;
		var e, t = xn, n = t.length, r, i = "value" in bn ? bn.value : bn.textContent, a = i.length;
		for (e = 0; e < n && t[e] === i[e]; e++);
		var o = n - e;
		for (r = 1; r <= o && t[n - r] === i[a - r]; r++);
		return Sn = i.slice(e, 1 < r ? 1 - r : void 0);
	}
	function wn(e) {
		var t = e.keyCode;
		return "charCode" in e ? (e = e.charCode, e === 0 && t === 13 && (e = 13)) : e = t, e === 10 && (e = 13), 32 <= e || e === 13 ? e : 0;
	}
	function Tn() {
		return !0;
	}
	function En() {
		return !1;
	}
	function Dn(e) {
		function t(t, n, r, i, a) {
			for (var o in this._reactName = t, this._targetInst = r, this.type = n, this.nativeEvent = i, this.target = a, this.currentTarget = null, e) e.hasOwnProperty(o) && (t = e[o], this[o] = t ? t(i) : i[o]);
			return this.isDefaultPrevented = (i.defaultPrevented == null ? !1 === i.returnValue : i.defaultPrevented) ? Tn : En, this.isPropagationStopped = En, this;
		}
		return h(t.prototype, {
			preventDefault: function() {
				this.defaultPrevented = !0;
				var e = this.nativeEvent;
				e && (e.preventDefault ? e.preventDefault() : typeof e.returnValue != "unknown" && (e.returnValue = !1), this.isDefaultPrevented = Tn);
			},
			stopPropagation: function() {
				var e = this.nativeEvent;
				e && (e.stopPropagation ? e.stopPropagation() : typeof e.cancelBubble != "unknown" && (e.cancelBubble = !0), this.isPropagationStopped = Tn);
			},
			persist: function() {},
			isPersistent: Tn
		}), t;
	}
	var On = {
		eventPhase: 0,
		bubbles: 0,
		cancelable: 0,
		timeStamp: function(e) {
			return e.timeStamp || Date.now();
		},
		defaultPrevented: 0,
		isTrusted: 0
	}, kn = Dn(On), An = h({}, On, {
		view: 0,
		detail: 0
	}), jn = Dn(An), Mn, Nn, Pn, Fn = h({}, An, {
		screenX: 0,
		screenY: 0,
		clientX: 0,
		clientY: 0,
		pageX: 0,
		pageY: 0,
		ctrlKey: 0,
		shiftKey: 0,
		altKey: 0,
		metaKey: 0,
		getModifierState: Kn,
		button: 0,
		buttons: 0,
		relatedTarget: function(e) {
			return e.relatedTarget === void 0 ? e.fromElement === e.srcElement ? e.toElement : e.fromElement : e.relatedTarget;
		},
		movementX: function(e) {
			return "movementX" in e ? e.movementX : (e !== Pn && (Pn && e.type === "mousemove" ? (Mn = e.screenX - Pn.screenX, Nn = e.screenY - Pn.screenY) : Nn = Mn = 0, Pn = e), Mn);
		},
		movementY: function(e) {
			return "movementY" in e ? e.movementY : Nn;
		}
	}), In = Dn(Fn), Ln = Dn(h({}, Fn, { dataTransfer: 0 })), Rn = Dn(h({}, An, { relatedTarget: 0 })), zn = Dn(h({}, On, {
		animationName: 0,
		elapsedTime: 0,
		pseudoElement: 0
	})), Bn = Dn(h({}, On, { clipboardData: function(e) {
		return "clipboardData" in e ? e.clipboardData : window.clipboardData;
	} })), Vn = Dn(h({}, On, { data: 0 })), Hn = {
		Esc: "Escape",
		Spacebar: " ",
		Left: "ArrowLeft",
		Up: "ArrowUp",
		Right: "ArrowRight",
		Down: "ArrowDown",
		Del: "Delete",
		Win: "OS",
		Menu: "ContextMenu",
		Apps: "ContextMenu",
		Scroll: "ScrollLock",
		MozPrintableKey: "Unidentified"
	}, Un = {
		8: "Backspace",
		9: "Tab",
		12: "Clear",
		13: "Enter",
		16: "Shift",
		17: "Control",
		18: "Alt",
		19: "Pause",
		20: "CapsLock",
		27: "Escape",
		32: " ",
		33: "PageUp",
		34: "PageDown",
		35: "End",
		36: "Home",
		37: "ArrowLeft",
		38: "ArrowUp",
		39: "ArrowRight",
		40: "ArrowDown",
		45: "Insert",
		46: "Delete",
		112: "F1",
		113: "F2",
		114: "F3",
		115: "F4",
		116: "F5",
		117: "F6",
		118: "F7",
		119: "F8",
		120: "F9",
		121: "F10",
		122: "F11",
		123: "F12",
		144: "NumLock",
		145: "ScrollLock",
		224: "Meta"
	}, Wn = {
		Alt: "altKey",
		Control: "ctrlKey",
		Meta: "metaKey",
		Shift: "shiftKey"
	};
	function Gn(e) {
		var t = this.nativeEvent;
		return t.getModifierState ? t.getModifierState(e) : (e = Wn[e]) ? !!t[e] : !1;
	}
	function Kn() {
		return Gn;
	}
	var qn = Dn(h({}, An, {
		key: function(e) {
			if (e.key) {
				var t = Hn[e.key] || e.key;
				if (t !== "Unidentified") return t;
			}
			return e.type === "keypress" ? (e = wn(e), e === 13 ? "Enter" : String.fromCharCode(e)) : e.type === "keydown" || e.type === "keyup" ? Un[e.keyCode] || "Unidentified" : "";
		},
		code: 0,
		location: 0,
		ctrlKey: 0,
		shiftKey: 0,
		altKey: 0,
		metaKey: 0,
		repeat: 0,
		locale: 0,
		getModifierState: Kn,
		charCode: function(e) {
			return e.type === "keypress" ? wn(e) : 0;
		},
		keyCode: function(e) {
			return e.type === "keydown" || e.type === "keyup" ? e.keyCode : 0;
		},
		which: function(e) {
			return e.type === "keypress" ? wn(e) : e.type === "keydown" || e.type === "keyup" ? e.keyCode : 0;
		}
	})), Jn = Dn(h({}, Fn, {
		pointerId: 0,
		width: 0,
		height: 0,
		pressure: 0,
		tangentialPressure: 0,
		tiltX: 0,
		tiltY: 0,
		twist: 0,
		pointerType: 0,
		isPrimary: 0
	})), Yn = Dn(h({}, An, {
		touches: 0,
		targetTouches: 0,
		changedTouches: 0,
		altKey: 0,
		metaKey: 0,
		ctrlKey: 0,
		shiftKey: 0,
		getModifierState: Kn
	})), Xn = Dn(h({}, On, {
		propertyName: 0,
		elapsedTime: 0,
		pseudoElement: 0
	})), Zn = Dn(h({}, Fn, {
		deltaX: function(e) {
			return "deltaX" in e ? e.deltaX : "wheelDeltaX" in e ? -e.wheelDeltaX : 0;
		},
		deltaY: function(e) {
			return "deltaY" in e ? e.deltaY : "wheelDeltaY" in e ? -e.wheelDeltaY : "wheelDelta" in e ? -e.wheelDelta : 0;
		},
		deltaZ: 0,
		deltaMode: 0
	})), Qn = Dn(h({}, On, {
		newState: 0,
		oldState: 0
	})), $n = [
		9,
		13,
		27,
		32
	], er = _n && "CompositionEvent" in window, tr = null;
	_n && "documentMode" in document && (tr = document.documentMode);
	var nr = _n && "TextEvent" in window && !tr, j = _n && (!er || tr && 8 < tr && 11 >= tr), rr = " ", ir = !1;
	function ar(e, t) {
		switch (e) {
			case "keyup": return $n.indexOf(t.keyCode) !== -1;
			case "keydown": return t.keyCode !== 229;
			case "keypress":
			case "mousedown":
			case "focusout": return !0;
			default: return !1;
		}
	}
	function or(e) {
		return e = e.detail, typeof e == "object" && "data" in e ? e.data : null;
	}
	var sr = !1;
	function cr(e, t) {
		switch (e) {
			case "compositionend": return or(t);
			case "keypress": return t.which === 32 ? (ir = !0, rr) : null;
			case "textInput": return e = t.data, e === rr && ir ? null : e;
			default: return null;
		}
	}
	function lr(e, t) {
		if (sr) return e === "compositionend" || !er && ar(e, t) ? (e = Cn(), Sn = xn = bn = null, sr = !1, e) : null;
		switch (e) {
			case "paste": return null;
			case "keypress":
				if (!(t.ctrlKey || t.altKey || t.metaKey) || t.ctrlKey && t.altKey) {
					if (t.char && 1 < t.char.length) return t.char;
					if (t.which) return String.fromCharCode(t.which);
				}
				return null;
			case "compositionend": return j && t.locale !== "ko" ? null : t.data;
			default: return null;
		}
	}
	var ur = {
		color: !0,
		date: !0,
		datetime: !0,
		"datetime-local": !0,
		email: !0,
		month: !0,
		number: !0,
		password: !0,
		range: !0,
		search: !0,
		tel: !0,
		text: !0,
		time: !0,
		url: !0,
		week: !0
	};
	function dr(e) {
		var t = e && e.nodeName && e.nodeName.toLowerCase();
		return t === "input" ? !!ur[e.type] : t === "textarea";
	}
	function fr(e, t, n, r) {
		A ? fn ? fn.push(r) : fn = [r] : A = r, t = Dd(t, "onChange"), 0 < t.length && (n = new kn("onChange", "change", null, n, r), e.push({
			event: n,
			listeners: t
		}));
	}
	var pr = null, mr = null;
	function hr(e) {
		bd(e, 0);
	}
	function gr(e) {
		if (Gt(Dt(e))) return e;
	}
	function _r(e, t) {
		if (e === "change") return t;
	}
	var vr = !1;
	if (_n) {
		var yr;
		if (_n) {
			var br = "oninput" in document;
			if (!br) {
				var xr = document.createElement("div");
				xr.setAttribute("oninput", "return;"), br = typeof xr.oninput == "function";
			}
			yr = br;
		} else yr = !1;
		vr = yr && (!document.documentMode || 9 < document.documentMode);
	}
	function Sr() {
		pr && (pr.detachEvent("onpropertychange", Cr), mr = pr = null);
	}
	function Cr(e) {
		if (e.propertyName === "value" && gr(mr)) {
			var t = [];
			fr(t, mr, e, dn(e)), hn(hr, t);
		}
	}
	function wr(e, t, n) {
		e === "focusin" ? (Sr(), pr = t, mr = n, pr.attachEvent("onpropertychange", Cr)) : e === "focusout" && Sr();
	}
	function Tr(e) {
		if (e === "selectionchange" || e === "keyup" || e === "keydown") return gr(mr);
	}
	function Er(e, t) {
		if (e === "click") return gr(t);
	}
	function Dr(e, t) {
		if (e === "input" || e === "change") return gr(t);
	}
	function Or(e, t) {
		return e === t && (e !== 0 || 1 / e == 1 / t) || e !== e && t !== t;
	}
	var kr = typeof Object.is == "function" ? Object.is : Or;
	function Ar(e, t) {
		if (kr(e, t)) return !0;
		if (typeof e != "object" || !e || typeof t != "object" || !t) return !1;
		var n = Object.keys(e), r = Object.keys(t);
		if (n.length !== r.length) return !1;
		for (r = 0; r < n.length; r++) {
			var i = n[r];
			if (!Ae.call(t, i) || !kr(e[i], t[i])) return !1;
		}
		return !0;
	}
	function jr(e) {
		for (; e && e.firstChild;) e = e.firstChild;
		return e;
	}
	function Mr(e, t) {
		var n = jr(e);
		e = 0;
		for (var r; n;) {
			if (n.nodeType === 3) {
				if (r = e + n.textContent.length, e <= t && r >= t) return {
					node: n,
					offset: t - e
				};
				e = r;
			}
			a: {
				for (; n;) {
					if (n.nextSibling) {
						n = n.nextSibling;
						break a;
					}
					n = n.parentNode;
				}
				n = void 0;
			}
			n = jr(n);
		}
	}
	function Nr(e, t) {
		return e && t ? e === t ? !0 : e && e.nodeType === 3 ? !1 : t && t.nodeType === 3 ? Nr(e, t.parentNode) : "contains" in e ? e.contains(t) : e.compareDocumentPosition ? !!(e.compareDocumentPosition(t) & 16) : !1 : !1;
	}
	function Pr(e) {
		e = e != null && e.ownerDocument != null && e.ownerDocument.defaultView != null ? e.ownerDocument.defaultView : window;
		for (var t = Kt(e.document); t instanceof e.HTMLIFrameElement;) {
			try {
				var n = typeof t.contentWindow.location.href == "string";
			} catch {
				n = !1;
			}
			if (n) e = t.contentWindow;
			else break;
			t = Kt(e.document);
		}
		return t;
	}
	function Fr(e) {
		var t = e && e.nodeName && e.nodeName.toLowerCase();
		return t && (t === "input" && (e.type === "text" || e.type === "search" || e.type === "tel" || e.type === "url" || e.type === "password") || t === "textarea" || e.contentEditable === "true");
	}
	var Ir = _n && "documentMode" in document && 11 >= document.documentMode, Lr = null, Rr = null, zr = null, Br = !1;
	function Vr(e, t, n) {
		var r = n.window === n ? n.document : n.nodeType === 9 ? n : n.ownerDocument;
		Br || Lr == null || Lr !== Kt(r) || (r = Lr, "selectionStart" in r && Fr(r) ? r = {
			start: r.selectionStart,
			end: r.selectionEnd
		} : (r = (r.ownerDocument && r.ownerDocument.defaultView || window).getSelection(), r = {
			anchorNode: r.anchorNode,
			anchorOffset: r.anchorOffset,
			focusNode: r.focusNode,
			focusOffset: r.focusOffset
		}), zr && Ar(zr, r) || (zr = r, r = Dd(Rr, "onSelect"), 0 < r.length && (t = new kn("onSelect", "select", null, t, n), e.push({
			event: t,
			listeners: r
		}), t.target = Lr)));
	}
	function Hr(e, t) {
		var n = {};
		return n[e.toLowerCase()] = t.toLowerCase(), n["Webkit" + e] = "webkit" + t, n["Moz" + e] = "moz" + t, n;
	}
	var Ur = {
		animationend: Hr("Animation", "AnimationEnd"),
		animationiteration: Hr("Animation", "AnimationIteration"),
		animationstart: Hr("Animation", "AnimationStart"),
		transitionrun: Hr("Transition", "TransitionRun"),
		transitionstart: Hr("Transition", "TransitionStart"),
		transitioncancel: Hr("Transition", "TransitionCancel"),
		transitionend: Hr("Transition", "TransitionEnd")
	}, Wr = {}, Gr = {};
	_n && (Gr = document.createElement("div").style, "AnimationEvent" in window || (delete Ur.animationend.animation, delete Ur.animationiteration.animation, delete Ur.animationstart.animation), "TransitionEvent" in window || delete Ur.transitionend.transition);
	function Kr(e) {
		if (Wr[e]) return Wr[e];
		if (!Ur[e]) return e;
		var t = Ur[e], n;
		for (n in t) if (t.hasOwnProperty(n) && n in Gr) return Wr[e] = t[n];
		return e;
	}
	var qr = Kr("animationend"), Jr = Kr("animationiteration"), Yr = Kr("animationstart"), Xr = Kr("transitionrun"), Zr = Kr("transitionstart"), Qr = Kr("transitioncancel"), $r = Kr("transitionend"), ei = /* @__PURE__ */ new Map(), ti = "abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");
	ti.push("scrollEnd");
	function ni(e, t) {
		ei.set(e, t), Mt(t, [e]);
	}
	var ri = typeof reportError == "function" ? reportError : function(e) {
		if (typeof window == "object" && typeof window.ErrorEvent == "function") {
			var t = new window.ErrorEvent("error", {
				bubbles: !0,
				cancelable: !0,
				message: typeof e == "object" && e && typeof e.message == "string" ? String(e.message) : String(e),
				error: e
			});
			if (!window.dispatchEvent(t)) return;
		} else if (typeof process == "object" && typeof process.emit == "function") {
			process.emit("uncaughtException", e);
			return;
		}
		console.error(e);
	}, ii = [], ai = 0, oi = 0;
	function si() {
		for (var e = ai, t = oi = ai = 0; t < e;) {
			var n = ii[t];
			ii[t++] = null;
			var r = ii[t];
			ii[t++] = null;
			var i = ii[t];
			ii[t++] = null;
			var a = ii[t];
			if (ii[t++] = null, r !== null && i !== null) {
				var o = r.pending;
				o === null ? i.next = i : (i.next = o.next, o.next = i), r.pending = i;
			}
			a !== 0 && di(n, i, a);
		}
	}
	function ci(e, t, n, r) {
		ii[ai++] = e, ii[ai++] = t, ii[ai++] = n, ii[ai++] = r, oi |= r, e.lanes |= r, e = e.alternate, e !== null && (e.lanes |= r);
	}
	function li(e, t, n, r) {
		return ci(e, t, n, r), fi(e);
	}
	function ui(e, t) {
		return ci(e, null, null, t), fi(e);
	}
	function di(e, t, n) {
		e.lanes |= n;
		var r = e.alternate;
		r !== null && (r.lanes |= n);
		for (var i = !1, a = e.return; a !== null;) a.childLanes |= n, r = a.alternate, r !== null && (r.childLanes |= n), a.tag === 22 && (e = a.stateNode, e === null || e._visibility & 1 || (i = !0)), e = a, a = a.return;
		return e.tag === 3 ? (a = e.stateNode, i && t !== null && (i = 31 - qe(n), e = a.hiddenUpdates, r = e[i], r === null ? e[i] = [t] : r.push(t), t.lane = n | 536870912), a) : null;
	}
	function fi(e) {
		if (50 < fu) throw fu = 0, pu = null, Error(s(185));
		for (var t = e.return; t !== null;) e = t, t = e.return;
		return e.tag === 3 ? e.stateNode : null;
	}
	var pi = {};
	function mi(e, t, n, r) {
		this.tag = e, this.key = n, this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null, this.index = 0, this.refCleanup = this.ref = null, this.pendingProps = t, this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null, this.mode = r, this.subtreeFlags = this.flags = 0, this.deletions = null, this.childLanes = this.lanes = 0, this.alternate = null;
	}
	function hi(e, t, n, r) {
		return new mi(e, t, n, r);
	}
	function gi(e) {
		return e = e.prototype, !(!e || !e.isReactComponent);
	}
	function _i(e, t) {
		var n = e.alternate;
		return n === null ? (n = hi(e.tag, t, e.key, e.mode), n.elementType = e.elementType, n.type = e.type, n.stateNode = e.stateNode, n.alternate = e, e.alternate = n) : (n.pendingProps = t, n.type = e.type, n.flags = 0, n.subtreeFlags = 0, n.deletions = null), n.flags = e.flags & 65011712, n.childLanes = e.childLanes, n.lanes = e.lanes, n.child = e.child, n.memoizedProps = e.memoizedProps, n.memoizedState = e.memoizedState, n.updateQueue = e.updateQueue, t = e.dependencies, n.dependencies = t === null ? null : {
			lanes: t.lanes,
			firstContext: t.firstContext
		}, n.sibling = e.sibling, n.index = e.index, n.ref = e.ref, n.refCleanup = e.refCleanup, n;
	}
	function vi(e, t) {
		e.flags &= 65011714;
		var n = e.alternate;
		return n === null ? (e.childLanes = 0, e.lanes = t, e.child = null, e.subtreeFlags = 0, e.memoizedProps = null, e.memoizedState = null, e.updateQueue = null, e.dependencies = null, e.stateNode = null) : (e.childLanes = n.childLanes, e.lanes = n.lanes, e.child = n.child, e.subtreeFlags = 0, e.deletions = null, e.memoizedProps = n.memoizedProps, e.memoizedState = n.memoizedState, e.updateQueue = n.updateQueue, e.type = n.type, t = n.dependencies, e.dependencies = t === null ? null : {
			lanes: t.lanes,
			firstContext: t.firstContext
		}), e;
	}
	function yi(e, t, n, r, i, a) {
		var o = 0;
		if (r = e, typeof e == "function") gi(e) && (o = 1);
		else if (typeof e == "string") o = Uf(e, n, he.current) ? 26 : e === "html" || e === "head" || e === "body" ? 27 : 5;
		else a: switch (e) {
			case ie: return e = hi(31, n, t, i), e.elementType = ie, e.lanes = a, e;
			case y: return bi(n.children, i, a, t);
			case b:
				o = 8, i |= 24;
				break;
			case x: return e = hi(12, n, t, i | 2), e.elementType = x, e.lanes = a, e;
			case ee: return e = hi(13, n, t, i), e.elementType = ee, e.lanes = a, e;
			case te: return e = hi(19, n, t, i), e.elementType = te, e.lanes = a, e;
			default:
				if (typeof e == "object" && e) switch (e.$$typeof) {
					case C:
						o = 10;
						break a;
					case S:
						o = 9;
						break a;
					case w:
						o = 11;
						break a;
					case ne:
						o = 14;
						break a;
					case re:
						o = 16, r = null;
						break a;
				}
				o = 29, n = Error(s(130, e === null ? "null" : typeof e, "")), r = null;
		}
		return t = hi(o, n, t, i), t.elementType = e, t.type = r, t.lanes = a, t;
	}
	function bi(e, t, n, r) {
		return e = hi(7, e, r, t), e.lanes = n, e;
	}
	function xi(e, t, n) {
		return e = hi(6, e, null, t), e.lanes = n, e;
	}
	function Si(e) {
		var t = hi(18, null, null, 0);
		return t.stateNode = e, t;
	}
	function Ci(e, t, n) {
		return t = hi(4, e.children === null ? [] : e.children, e.key, t), t.lanes = n, t.stateNode = {
			containerInfo: e.containerInfo,
			pendingChildren: null,
			implementation: e.implementation
		}, t;
	}
	var wi = /* @__PURE__ */ new WeakMap();
	function Ti(e, t) {
		if (typeof e == "object" && e) {
			var n = wi.get(e);
			return n === void 0 ? (t = {
				value: e,
				source: t,
				stack: ke(t)
			}, wi.set(e, t), t) : n;
		}
		return {
			value: e,
			source: t,
			stack: ke(t)
		};
	}
	var Ei = [], Di = 0, Oi = null, ki = 0, Ai = [], ji = 0, Mi = null, Ni = 1, Pi = "";
	function Fi(e, t) {
		Ei[Di++] = ki, Ei[Di++] = Oi, Oi = e, ki = t;
	}
	function Ii(e, t, n) {
		Ai[ji++] = Ni, Ai[ji++] = Pi, Ai[ji++] = Mi, Mi = e;
		var r = Ni;
		e = Pi;
		var i = 32 - qe(r) - 1;
		r &= ~(1 << i), n += 1;
		var a = 32 - qe(t) + i;
		if (30 < a) {
			var o = i - i % 5;
			a = (r & (1 << o) - 1).toString(32), r >>= o, i -= o, Ni = 1 << 32 - qe(t) + i | n << i | r, Pi = a + e;
		} else Ni = 1 << a | n << i | r, Pi = e;
	}
	function Li(e) {
		e.return !== null && (Fi(e, 1), Ii(e, 1, 0));
	}
	function Ri(e) {
		for (; e === Oi;) Oi = Ei[--Di], Ei[Di] = null, ki = Ei[--Di], Ei[Di] = null;
		for (; e === Mi;) Mi = Ai[--ji], Ai[ji] = null, Pi = Ai[--ji], Ai[ji] = null, Ni = Ai[--ji], Ai[ji] = null;
	}
	function zi(e, t) {
		Ai[ji++] = Ni, Ai[ji++] = Pi, Ai[ji++] = Mi, Ni = t.id, Pi = t.overflow, Mi = e;
	}
	var Bi = null, Vi = null, M = !1, Hi = null, Ui = !1, Wi = Error(s(519));
	function Gi(e) {
		throw Zi(Ti(Error(s(418, 1 < arguments.length && arguments[1] !== void 0 && arguments[1] ? "text" : "HTML", "")), e)), Wi;
	}
	function Ki(e) {
		var t = e.stateNode, n = e.type, r = e.memoizedProps;
		switch (t[gt] = e, t[_t] = r, n) {
			case "dialog":
				Z("cancel", t), Z("close", t);
				break;
			case "iframe":
			case "object":
			case "embed":
				Z("load", t);
				break;
			case "video":
			case "audio":
				for (n = 0; n < vd.length; n++) Z(vd[n], t);
				break;
			case "source":
				Z("error", t);
				break;
			case "img":
			case "image":
			case "link":
				Z("error", t), Z("load", t);
				break;
			case "details":
				Z("toggle", t);
				break;
			case "input":
				Z("invalid", t), Xt(t, r.value, r.defaultValue, r.checked, r.defaultChecked, r.type, r.name, !0);
				break;
			case "select":
				Z("invalid", t);
				break;
			case "textarea": Z("invalid", t), en(t, r.value, r.defaultValue, r.children);
		}
		n = r.children, typeof n != "string" && typeof n != "number" && typeof n != "bigint" || t.textContent === "" + n || !0 === r.suppressHydrationWarning || Nd(t.textContent, n) ? (r.popover != null && (Z("beforetoggle", t), Z("toggle", t)), r.onScroll != null && Z("scroll", t), r.onScrollEnd != null && Z("scrollend", t), r.onClick != null && (t.onclick = un), t = !0) : t = !1, t || Gi(e, !0);
	}
	function qi(e) {
		for (Bi = e.return; Bi;) switch (Bi.tag) {
			case 5:
			case 31:
			case 13:
				Ui = !1;
				return;
			case 27:
			case 3:
				Ui = !0;
				return;
			default: Bi = Bi.return;
		}
	}
	function Ji(e) {
		if (e !== Bi) return !1;
		if (!M) return qi(e), M = !0, !1;
		var t = e.tag, n;
		if ((n = t !== 3 && t !== 27) && ((n = t === 5) && (n = e.type, n = n === "form" || n === "button" || Ud(e.type, e.memoizedProps)), n = !n), n && Vi && Gi(e), qi(e), t === 13) {
			if (e = e.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(s(317));
			Vi = uf(e);
		} else if (t === 31) {
			if (e = e.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(s(317));
			Vi = uf(e);
		} else t === 27 ? (t = Vi, Zd(e.type) ? (e = lf, lf = null, Vi = e) : Vi = t) : Vi = Bi ? cf(e.stateNode.nextSibling) : null;
		return !0;
	}
	function Yi() {
		Vi = Bi = null, M = !1;
	}
	function Xi() {
		var e = Hi;
		return e !== null && (Ql === null ? Ql = e : Ql.push.apply(Ql, e), Hi = null), e;
	}
	function Zi(e) {
		Hi === null ? Hi = [e] : Hi.push(e);
	}
	var Qi = pe(null), $i = null, ea = null;
	function ta(e, t, n) {
		O(Qi, t._currentValue), t._currentValue = n;
	}
	function na(e) {
		e._currentValue = Qi.current, me(Qi);
	}
	function ra(e, t, n) {
		for (; e !== null;) {
			var r = e.alternate;
			if ((e.childLanes & t) === t ? r !== null && (r.childLanes & t) !== t && (r.childLanes |= t) : (e.childLanes |= t, r !== null && (r.childLanes |= t)), e === n) break;
			e = e.return;
		}
	}
	function ia(e, t, n, r) {
		var i = e.child;
		for (i !== null && (i.return = e); i !== null;) {
			var a = i.dependencies;
			if (a !== null) {
				var o = i.child;
				a = a.firstContext;
				a: for (; a !== null;) {
					var c = a;
					a = i;
					for (var l = 0; l < t.length; l++) if (c.context === t[l]) {
						a.lanes |= n, c = a.alternate, c !== null && (c.lanes |= n), ra(a.return, n, e), r || (o = null);
						break a;
					}
					a = c.next;
				}
			} else if (i.tag === 18) {
				if (o = i.return, o === null) throw Error(s(341));
				o.lanes |= n, a = o.alternate, a !== null && (a.lanes |= n), ra(o, n, e), o = null;
			} else o = i.child;
			if (o !== null) o.return = i;
			else for (o = i; o !== null;) {
				if (o === e) {
					o = null;
					break;
				}
				if (i = o.sibling, i !== null) {
					i.return = o.return, o = i;
					break;
				}
				o = o.return;
			}
			i = o;
		}
	}
	function aa(e, t, n, r) {
		e = null;
		for (var i = t, a = !1; i !== null;) {
			if (!a) {
				if (i.flags & 524288) a = !0;
				else if (i.flags & 262144) break;
			}
			if (i.tag === 10) {
				var o = i.alternate;
				if (o === null) throw Error(s(387));
				if (o = o.memoizedProps, o !== null) {
					var c = i.type;
					kr(i.pendingProps.value, o.value) || (e === null ? e = [c] : e.push(c));
				}
			} else if (i === ve.current) {
				if (o = i.alternate, o === null) throw Error(s(387));
				o.memoizedState.memoizedState !== i.memoizedState.memoizedState && (e === null ? e = [Qf] : e.push(Qf));
			}
			i = i.return;
		}
		e !== null && ia(t, e, n, r), t.flags |= 262144;
	}
	function oa(e) {
		for (e = e.firstContext; e !== null;) {
			if (!kr(e.context._currentValue, e.memoizedValue)) return !0;
			e = e.next;
		}
		return !1;
	}
	function sa(e) {
		$i = e, ea = null, e = e.dependencies, e !== null && (e.firstContext = null);
	}
	function ca(e) {
		return ua($i, e);
	}
	function la(e, t) {
		return $i === null && sa(e), ua(e, t);
	}
	function ua(e, t) {
		var n = t._currentValue;
		if (t = {
			context: t,
			memoizedValue: n,
			next: null
		}, ea === null) {
			if (e === null) throw Error(s(308));
			ea = t, e.dependencies = {
				lanes: 0,
				firstContext: t
			}, e.flags |= 524288;
		} else ea = ea.next = t;
		return n;
	}
	var da = typeof AbortController < "u" ? AbortController : function() {
		var e = [], t = this.signal = {
			aborted: !1,
			addEventListener: function(t, n) {
				e.push(n);
			}
		};
		this.abort = function() {
			t.aborted = !0, e.forEach(function(e) {
				return e();
			});
		};
	}, fa = t.unstable_scheduleCallback, pa = t.unstable_NormalPriority, ma = {
		$$typeof: C,
		Consumer: null,
		Provider: null,
		_currentValue: null,
		_currentValue2: null,
		_threadCount: 0
	};
	function ha() {
		return {
			controller: new da(),
			data: /* @__PURE__ */ new Map(),
			refCount: 0
		};
	}
	function ga(e) {
		e.refCount--, e.refCount === 0 && fa(pa, function() {
			e.controller.abort();
		});
	}
	var _a = null, va = 0, ya = 0, ba = null;
	function xa(e, t) {
		if (_a === null) {
			var n = _a = [];
			va = 0, ya = fd(), ba = {
				status: "pending",
				value: void 0,
				then: function(e) {
					n.push(e);
				}
			};
		}
		return va++, t.then(Sa, Sa), t;
	}
	function Sa() {
		if (--va === 0 && _a !== null) {
			ba !== null && (ba.status = "fulfilled");
			var e = _a;
			_a = null, ya = 0, ba = null;
			for (var t = 0; t < e.length; t++) (0, e[t])();
		}
	}
	function Ca(e, t) {
		var n = [], r = {
			status: "pending",
			value: null,
			reason: null,
			then: function(e) {
				n.push(e);
			}
		};
		return e.then(function() {
			r.status = "fulfilled", r.value = t;
			for (var e = 0; e < n.length; e++) (0, n[e])(t);
		}, function(e) {
			for (r.status = "rejected", r.reason = e, e = 0; e < n.length; e++) (0, n[e])(void 0);
		}), r;
	}
	var wa = E.S;
	E.S = function(e, t) {
		tu = Fe(), typeof t == "object" && t && typeof t.then == "function" && xa(e, t), wa !== null && wa(e, t);
	};
	var Ta = pe(null);
	function Ea() {
		var e = Ta.current;
		return e === null ? K.pooledCache : e;
	}
	function Da(e, t) {
		t === null ? O(Ta, Ta.current) : O(Ta, t.pool);
	}
	function N() {
		var e = Ea();
		return e === null ? null : {
			parent: ma._currentValue,
			pool: e
		};
	}
	var Oa = Error(s(460)), ka = Error(s(474)), Aa = Error(s(542)), ja = { then: function() {} };
	function Ma(e) {
		return e = e.status, e === "fulfilled" || e === "rejected";
	}
	function Na(e, t, n) {
		switch (n = e[n], n === void 0 ? e.push(t) : n !== t && (t.then(un, un), t = n), t.status) {
			case "fulfilled": return t.value;
			case "rejected": throw e = t.reason, La(e), e;
			default:
				if (typeof t.status == "string") t.then(un, un);
				else {
					if (e = K, e !== null && 100 < e.shellSuspendCounter) throw Error(s(482));
					e = t, e.status = "pending", e.then(function(e) {
						if (t.status === "pending") {
							var n = t;
							n.status = "fulfilled", n.value = e;
						}
					}, function(e) {
						if (t.status === "pending") {
							var n = t;
							n.status = "rejected", n.reason = e;
						}
					});
				}
				switch (t.status) {
					case "fulfilled": return t.value;
					case "rejected": throw e = t.reason, La(e), e;
				}
				throw Fa = t, Oa;
		}
	}
	function Pa(e) {
		try {
			var t = e._init;
			return t(e._payload);
		} catch (e) {
			throw typeof e == "object" && e && typeof e.then == "function" ? (Fa = e, Oa) : e;
		}
	}
	var Fa = null;
	function Ia() {
		if (Fa === null) throw Error(s(459));
		var e = Fa;
		return Fa = null, e;
	}
	function La(e) {
		if (e === Oa || e === Aa) throw Error(s(483));
	}
	var Ra = null, za = 0;
	function Ba(e) {
		var t = za;
		return za += 1, Ra === null && (Ra = []), Na(Ra, e, t);
	}
	function P(e, t) {
		t = t.props.ref, e.ref = t === void 0 ? null : t;
	}
	function Va(e, t) {
		throw t.$$typeof === g ? Error(s(525)) : (e = Object.prototype.toString.call(t), Error(s(31, e === "[object Object]" ? "object with keys {" + Object.keys(t).join(", ") + "}" : e)));
	}
	function Ha(e) {
		function t(t, n) {
			if (e) {
				var r = t.deletions;
				r === null ? (t.deletions = [n], t.flags |= 16) : r.push(n);
			}
		}
		function n(n, r) {
			if (!e) return null;
			for (; r !== null;) t(n, r), r = r.sibling;
			return null;
		}
		function r(e) {
			for (var t = /* @__PURE__ */ new Map(); e !== null;) e.key === null ? t.set(e.index, e) : t.set(e.key, e), e = e.sibling;
			return t;
		}
		function i(e, t) {
			return e = _i(e, t), e.index = 0, e.sibling = null, e;
		}
		function a(t, n, r) {
			return t.index = r, e ? (r = t.alternate, r === null ? (t.flags |= 67108866, n) : (r = r.index, r < n ? (t.flags |= 67108866, n) : r)) : (t.flags |= 1048576, n);
		}
		function o(t) {
			return e && t.alternate === null && (t.flags |= 67108866), t;
		}
		function c(e, t, n, r) {
			return t === null || t.tag !== 6 ? (t = xi(n, e.mode, r), t.return = e, t) : (t = i(t, n), t.return = e, t);
		}
		function l(e, t, n, r) {
			var a = n.type;
			return a === y ? d(e, t, n.props.children, r, n.key) : t !== null && (t.elementType === a || typeof a == "object" && a && a.$$typeof === re && Pa(a) === t.type) ? (t = i(t, n.props), P(t, n), t.return = e, t) : (t = yi(n.type, n.key, n.props, null, e.mode, r), P(t, n), t.return = e, t);
		}
		function u(e, t, n, r) {
			return t === null || t.tag !== 4 || t.stateNode.containerInfo !== n.containerInfo || t.stateNode.implementation !== n.implementation ? (t = Ci(n, e.mode, r), t.return = e, t) : (t = i(t, n.children || []), t.return = e, t);
		}
		function d(e, t, n, r, a) {
			return t === null || t.tag !== 7 ? (t = bi(n, e.mode, r, a), t.return = e, t) : (t = i(t, n), t.return = e, t);
		}
		function f(e, t, n) {
			if (typeof t == "string" && t !== "" || typeof t == "number" || typeof t == "bigint") return t = xi("" + t, e.mode, n), t.return = e, t;
			if (typeof t == "object" && t) {
				switch (t.$$typeof) {
					case _: return n = yi(t.type, t.key, t.props, null, e.mode, n), P(n, t), n.return = e, n;
					case v: return t = Ci(t, e.mode, n), t.return = e, t;
					case re: return t = Pa(t), f(e, t, n);
				}
				if (le(t) || se(t)) return t = bi(t, e.mode, n, null), t.return = e, t;
				if (typeof t.then == "function") return f(e, Ba(t), n);
				if (t.$$typeof === C) return f(e, la(e, t), n);
				Va(e, t);
			}
			return null;
		}
		function p(e, t, n, r) {
			var i = t === null ? null : t.key;
			if (typeof n == "string" && n !== "" || typeof n == "number" || typeof n == "bigint") return i === null ? c(e, t, "" + n, r) : null;
			if (typeof n == "object" && n) {
				switch (n.$$typeof) {
					case _: return n.key === i ? l(e, t, n, r) : null;
					case v: return n.key === i ? u(e, t, n, r) : null;
					case re: return n = Pa(n), p(e, t, n, r);
				}
				if (le(n) || se(n)) return i === null ? d(e, t, n, r, null) : null;
				if (typeof n.then == "function") return p(e, t, Ba(n), r);
				if (n.$$typeof === C) return p(e, t, la(e, n), r);
				Va(e, n);
			}
			return null;
		}
		function m(e, t, n, r, i) {
			if (typeof r == "string" && r !== "" || typeof r == "number" || typeof r == "bigint") return e = e.get(n) || null, c(t, e, "" + r, i);
			if (typeof r == "object" && r) {
				switch (r.$$typeof) {
					case _: return e = e.get(r.key === null ? n : r.key) || null, l(t, e, r, i);
					case v: return e = e.get(r.key === null ? n : r.key) || null, u(t, e, r, i);
					case re: return r = Pa(r), m(e, t, n, r, i);
				}
				if (le(r) || se(r)) return e = e.get(n) || null, d(t, e, r, i, null);
				if (typeof r.then == "function") return m(e, t, n, Ba(r), i);
				if (r.$$typeof === C) return m(e, t, n, la(t, r), i);
				Va(t, r);
			}
			return null;
		}
		function h(i, o, s, c) {
			for (var l = null, u = null, d = o, h = o = 0, g = null; d !== null && h < s.length; h++) {
				d.index > h ? (g = d, d = null) : g = d.sibling;
				var _ = p(i, d, s[h], c);
				if (_ === null) {
					d === null && (d = g);
					break;
				}
				e && d && _.alternate === null && t(i, d), o = a(_, o, h), u === null ? l = _ : u.sibling = _, u = _, d = g;
			}
			if (h === s.length) return n(i, d), M && Fi(i, h), l;
			if (d === null) {
				for (; h < s.length; h++) d = f(i, s[h], c), d !== null && (o = a(d, o, h), u === null ? l = d : u.sibling = d, u = d);
				return M && Fi(i, h), l;
			}
			for (d = r(d); h < s.length; h++) g = m(d, i, h, s[h], c), g !== null && (e && g.alternate !== null && d.delete(g.key === null ? h : g.key), o = a(g, o, h), u === null ? l = g : u.sibling = g, u = g);
			return e && d.forEach(function(e) {
				return t(i, e);
			}), M && Fi(i, h), l;
		}
		function g(i, o, c, l) {
			if (c == null) throw Error(s(151));
			for (var u = null, d = null, h = o, g = o = 0, _ = null, v = c.next(); h !== null && !v.done; g++, v = c.next()) {
				h.index > g ? (_ = h, h = null) : _ = h.sibling;
				var y = p(i, h, v.value, l);
				if (y === null) {
					h === null && (h = _);
					break;
				}
				e && h && y.alternate === null && t(i, h), o = a(y, o, g), d === null ? u = y : d.sibling = y, d = y, h = _;
			}
			if (v.done) return n(i, h), M && Fi(i, g), u;
			if (h === null) {
				for (; !v.done; g++, v = c.next()) v = f(i, v.value, l), v !== null && (o = a(v, o, g), d === null ? u = v : d.sibling = v, d = v);
				return M && Fi(i, g), u;
			}
			for (h = r(h); !v.done; g++, v = c.next()) v = m(h, i, g, v.value, l), v !== null && (e && v.alternate !== null && h.delete(v.key === null ? g : v.key), o = a(v, o, g), d === null ? u = v : d.sibling = v, d = v);
			return e && h.forEach(function(e) {
				return t(i, e);
			}), M && Fi(i, g), u;
		}
		function b(e, r, a, c) {
			if (typeof a == "object" && a && a.type === y && a.key === null && (a = a.props.children), typeof a == "object" && a) {
				switch (a.$$typeof) {
					case _:
						a: {
							for (var l = a.key; r !== null;) {
								if (r.key === l) {
									if (l = a.type, l === y) {
										if (r.tag === 7) {
											n(e, r.sibling), c = i(r, a.props.children), c.return = e, e = c;
											break a;
										}
									} else if (r.elementType === l || typeof l == "object" && l && l.$$typeof === re && Pa(l) === r.type) {
										n(e, r.sibling), c = i(r, a.props), P(c, a), c.return = e, e = c;
										break a;
									}
									n(e, r);
									break;
								}
								t(e, r), r = r.sibling;
							}
							a.type === y ? (c = bi(a.props.children, e.mode, c, a.key), c.return = e, e = c) : (c = yi(a.type, a.key, a.props, null, e.mode, c), P(c, a), c.return = e, e = c);
						}
						return o(e);
					case v:
						a: {
							for (l = a.key; r !== null;) {
								if (r.key === l) {
									if (r.tag === 4 && r.stateNode.containerInfo === a.containerInfo && r.stateNode.implementation === a.implementation) {
										n(e, r.sibling), c = i(r, a.children || []), c.return = e, e = c;
										break a;
									}
									n(e, r);
									break;
								}
								t(e, r), r = r.sibling;
							}
							c = Ci(a, e.mode, c), c.return = e, e = c;
						}
						return o(e);
					case re: return a = Pa(a), b(e, r, a, c);
				}
				if (le(a)) return h(e, r, a, c);
				if (se(a)) {
					if (l = se(a), typeof l != "function") throw Error(s(150));
					return a = l.call(a), g(e, r, a, c);
				}
				if (typeof a.then == "function") return b(e, r, Ba(a), c);
				if (a.$$typeof === C) return b(e, r, la(e, a), c);
				Va(e, a);
			}
			return typeof a == "string" && a !== "" || typeof a == "number" || typeof a == "bigint" ? (a = "" + a, r !== null && r.tag === 6 ? (n(e, r.sibling), c = i(r, a), c.return = e, e = c) : (n(e, r), c = xi(a, e.mode, c), c.return = e, e = c), o(e)) : n(e, r);
		}
		return function(e, t, n, r) {
			try {
				za = 0;
				var i = b(e, t, n, r);
				return Ra = null, i;
			} catch (t) {
				if (t === Oa || t === Aa) throw t;
				var a = hi(29, t, null, e.mode);
				return a.lanes = r, a.return = e, a;
			}
		};
	}
	var Ua = Ha(!0), Wa = Ha(!1), Ga = !1;
	function Ka(e) {
		e.updateQueue = {
			baseState: e.memoizedState,
			firstBaseUpdate: null,
			lastBaseUpdate: null,
			shared: {
				pending: null,
				lanes: 0,
				hiddenCallbacks: null
			},
			callbacks: null
		};
	}
	function qa(e, t) {
		e = e.updateQueue, t.updateQueue === e && (t.updateQueue = {
			baseState: e.baseState,
			firstBaseUpdate: e.firstBaseUpdate,
			lastBaseUpdate: e.lastBaseUpdate,
			shared: e.shared,
			callbacks: null
		});
	}
	function Ja(e) {
		return {
			lane: e,
			tag: 0,
			payload: null,
			callback: null,
			next: null
		};
	}
	function Ya(e, t, n) {
		var r = e.updateQueue;
		if (r === null) return null;
		if (r = r.shared, G & 2) {
			var i = r.pending;
			return i === null ? t.next = t : (t.next = i.next, i.next = t), r.pending = t, t = fi(e), di(e, null, n), t;
		}
		return ci(e, r, t, n), fi(e);
	}
	function Xa(e, t, n) {
		if (t = t.updateQueue, t !== null && (t = t.shared, n & 4194048)) {
			var r = t.lanes;
			r &= e.pendingLanes, n |= r, t.lanes = n, lt(e, n);
		}
	}
	function Za(e, t) {
		var n = e.updateQueue, r = e.alternate;
		if (r !== null && (r = r.updateQueue, n === r)) {
			var i = null, a = null;
			if (n = n.firstBaseUpdate, n !== null) {
				do {
					var o = {
						lane: n.lane,
						tag: n.tag,
						payload: n.payload,
						callback: null,
						next: null
					};
					a === null ? i = a = o : a = a.next = o, n = n.next;
				} while (n !== null);
				a === null ? i = a = t : a = a.next = t;
			} else i = a = t;
			n = {
				baseState: r.baseState,
				firstBaseUpdate: i,
				lastBaseUpdate: a,
				shared: r.shared,
				callbacks: r.callbacks
			}, e.updateQueue = n;
			return;
		}
		e = n.lastBaseUpdate, e === null ? n.firstBaseUpdate = t : e.next = t, n.lastBaseUpdate = t;
	}
	var Qa = !1;
	function $a() {
		if (Qa) {
			var e = ba;
			if (e !== null) throw e;
		}
	}
	function eo(e, t, n, r) {
		Qa = !1;
		var i = e.updateQueue;
		Ga = !1;
		var a = i.firstBaseUpdate, o = i.lastBaseUpdate, s = i.shared.pending;
		if (s !== null) {
			i.shared.pending = null;
			var c = s, l = c.next;
			c.next = null, o === null ? a = l : o.next = l, o = c;
			var u = e.alternate;
			u !== null && (u = u.updateQueue, s = u.lastBaseUpdate, s !== o && (s === null ? u.firstBaseUpdate = l : s.next = l, u.lastBaseUpdate = c));
		}
		if (a !== null) {
			var d = i.baseState;
			o = 0, u = l = c = null, s = a;
			do {
				var f = s.lane & -536870913, p = f !== s.lane;
				if (p ? (J & f) === f : (r & f) === f) {
					f !== 0 && f === ya && (Qa = !0), u !== null && (u = u.next = {
						lane: 0,
						tag: s.tag,
						payload: s.payload,
						callback: null,
						next: null
					});
					a: {
						var m = e, g = s;
						f = t;
						var _ = n;
						switch (g.tag) {
							case 1:
								if (m = g.payload, typeof m == "function") {
									d = m.call(_, d, f);
									break a;
								}
								d = m;
								break a;
							case 3: m.flags = m.flags & -65537 | 128;
							case 0:
								if (m = g.payload, f = typeof m == "function" ? m.call(_, d, f) : m, f == null) break a;
								d = h({}, d, f);
								break a;
							case 2: Ga = !0;
						}
					}
					f = s.callback, f !== null && (e.flags |= 64, p && (e.flags |= 8192), p = i.callbacks, p === null ? i.callbacks = [f] : p.push(f));
				} else p = {
					lane: f,
					tag: s.tag,
					payload: s.payload,
					callback: s.callback,
					next: null
				}, u === null ? (l = u = p, c = d) : u = u.next = p, o |= f;
				if (s = s.next, s === null) {
					if (s = i.shared.pending, s === null) break;
					p = s, s = p.next, p.next = null, i.lastBaseUpdate = p, i.shared.pending = null;
				}
			} while (1);
			u === null && (c = d), i.baseState = c, i.firstBaseUpdate = l, i.lastBaseUpdate = u, a === null && (i.shared.lanes = 0), Kl |= o, e.lanes = o, e.memoizedState = d;
		}
	}
	function to(e, t) {
		if (typeof e != "function") throw Error(s(191, e));
		e.call(t);
	}
	function no(e, t) {
		var n = e.callbacks;
		if (n !== null) for (e.callbacks = null, e = 0; e < n.length; e++) to(n[e], t);
	}
	var ro = pe(null), io = pe(0);
	function ao(e, t) {
		e = Wl, O(io, e), O(ro, t), Wl = e | t.baseLanes;
	}
	function oo() {
		O(io, Wl), O(ro, ro.current);
	}
	function so() {
		Wl = io.current, me(ro), me(io);
	}
	var co = pe(null), lo = null;
	function uo(e) {
		var t = e.alternate;
		O(I, I.current & 1), O(co, e), lo === null && (t === null || ro.current !== null || t.memoizedState !== null) && (lo = e);
	}
	function fo(e) {
		O(I, I.current), O(co, e), lo === null && (lo = e);
	}
	function F(e) {
		e.tag === 22 ? (O(I, I.current), O(co, e), lo === null && (lo = e)) : po(e);
	}
	function po() {
		O(I, I.current), O(co, co.current);
	}
	function mo(e) {
		me(co), lo === e && (lo = null), me(I);
	}
	var I = pe(0);
	function ho(e) {
		for (var t = e; t !== null;) {
			if (t.tag === 13) {
				var n = t.memoizedState;
				if (n !== null && (n = n.dehydrated, n === null || af(n) || of(n))) return t;
			} else if (t.tag === 19 && (t.memoizedProps.revealOrder === "forwards" || t.memoizedProps.revealOrder === "backwards" || t.memoizedProps.revealOrder === "unstable_legacy-backwards" || t.memoizedProps.revealOrder === "together")) {
				if (t.flags & 128) return t;
			} else if (t.child !== null) {
				t.child.return = t, t = t.child;
				continue;
			}
			if (t === e) break;
			for (; t.sibling === null;) {
				if (t.return === null || t.return === e) return null;
				t = t.return;
			}
			t.sibling.return = t.return, t = t.sibling;
		}
		return null;
	}
	var go = 0, L = null, R = null, _o = null, vo = !1, yo = !1, bo = !1, xo = 0, So = 0, Co = null, wo = 0;
	function To() {
		throw Error(s(321));
	}
	function Eo(e, t) {
		if (t === null) return !1;
		for (var n = 0; n < t.length && n < e.length; n++) if (!kr(e[n], t[n])) return !1;
		return !0;
	}
	function Do(e, t, n, r, i, a) {
		return go = a, L = t, t.memoizedState = null, t.updateQueue = null, t.lanes = 0, E.H = e === null || e.memoizedState === null ? Vs : Hs, bo = !1, a = n(r, i), bo = !1, yo && (a = ko(t, n, r, i)), Oo(e), a;
	}
	function Oo(e) {
		E.H = Bs;
		var t = R !== null && R.next !== null;
		if (go = 0, _o = R = L = null, vo = !1, So = 0, Co = null, t) throw Error(s(300));
		e === null || ac || (e = e.dependencies, e !== null && oa(e) && (ac = !0));
	}
	function ko(e, t, n, r) {
		L = e;
		var i = 0;
		do {
			if (yo && (Co = null), So = 0, yo = !1, 25 <= i) throw Error(s(301));
			if (i += 1, _o = R = null, e.updateQueue != null) {
				var a = e.updateQueue;
				a.lastEffect = null, a.events = null, a.stores = null, a.memoCache != null && (a.memoCache.index = 0);
			}
			E.H = Us, a = t(n, r);
		} while (yo);
		return a;
	}
	function Ao() {
		var e = E.H, t = e.useState()[0];
		return t = typeof t.then == "function" ? Lo(t) : t, e = e.useState()[0], (R === null ? null : R.memoizedState) !== e && (L.flags |= 1024), t;
	}
	function jo() {
		var e = xo !== 0;
		return xo = 0, e;
	}
	function Mo(e, t, n) {
		t.updateQueue = e.updateQueue, t.flags &= -2053, e.lanes &= ~n;
	}
	function No(e) {
		if (vo) {
			for (e = e.memoizedState; e !== null;) {
				var t = e.queue;
				t !== null && (t.pending = null), e = e.next;
			}
			vo = !1;
		}
		go = 0, _o = R = L = null, yo = !1, So = xo = 0, Co = null;
	}
	function Po() {
		var e = {
			memoizedState: null,
			baseState: null,
			baseQueue: null,
			queue: null,
			next: null
		};
		return _o === null ? L.memoizedState = _o = e : _o = _o.next = e, _o;
	}
	function Fo() {
		if (R === null) {
			var e = L.alternate;
			e = e === null ? null : e.memoizedState;
		} else e = R.next;
		var t = _o === null ? L.memoizedState : _o.next;
		if (t !== null) _o = t, R = e;
		else {
			if (e === null) throw L.alternate === null ? Error(s(467)) : Error(s(310));
			R = e, e = {
				memoizedState: R.memoizedState,
				baseState: R.baseState,
				baseQueue: R.baseQueue,
				queue: R.queue,
				next: null
			}, _o === null ? L.memoizedState = _o = e : _o = _o.next = e;
		}
		return _o;
	}
	function Io() {
		return {
			lastEffect: null,
			events: null,
			stores: null,
			memoCache: null
		};
	}
	function Lo(e) {
		var t = So;
		return So += 1, Co === null && (Co = []), e = Na(Co, e, t), t = L, (_o === null ? t.memoizedState : _o.next) === null && (t = t.alternate, E.H = t === null || t.memoizedState === null ? Vs : Hs), e;
	}
	function Ro(e) {
		if (typeof e == "object" && e) {
			if (typeof e.then == "function") return Lo(e);
			if (e.$$typeof === C) return ca(e);
		}
		throw Error(s(438, String(e)));
	}
	function zo(e) {
		var t = null, n = L.updateQueue;
		if (n !== null && (t = n.memoCache), t == null) {
			var r = L.alternate;
			r !== null && (r = r.updateQueue, r !== null && (r = r.memoCache, r != null && (t = {
				data: r.data.map(function(e) {
					return e.slice();
				}),
				index: 0
			})));
		}
		if (t ??= {
			data: [],
			index: 0
		}, n === null && (n = Io(), L.updateQueue = n), n.memoCache = t, n = t.data[t.index], n === void 0) for (n = t.data[t.index] = Array(e), r = 0; r < e; r++) n[r] = ae;
		return t.index++, n;
	}
	function Bo(e, t) {
		return typeof t == "function" ? t(e) : t;
	}
	function z(e) {
		return Vo(Fo(), R, e);
	}
	function Vo(e, t, n) {
		var r = e.queue;
		if (r === null) throw Error(s(311));
		r.lastRenderedReducer = n;
		var i = e.baseQueue, a = r.pending;
		if (a !== null) {
			if (i !== null) {
				var o = i.next;
				i.next = a.next, a.next = o;
			}
			t.baseQueue = i = a, r.pending = null;
		}
		if (a = e.baseState, i === null) e.memoizedState = a;
		else {
			t = i.next;
			var c = o = null, l = null, u = t, d = !1;
			do {
				var f = u.lane & -536870913;
				if (f === u.lane ? (go & f) === f : (J & f) === f) {
					var p = u.revertLane;
					if (p === 0) l !== null && (l = l.next = {
						lane: 0,
						revertLane: 0,
						gesture: null,
						action: u.action,
						hasEagerState: u.hasEagerState,
						eagerState: u.eagerState,
						next: null
					}), f === ya && (d = !0);
					else if ((go & p) === p) {
						u = u.next, p === ya && (d = !0);
						continue;
					} else f = {
						lane: 0,
						revertLane: u.revertLane,
						gesture: null,
						action: u.action,
						hasEagerState: u.hasEagerState,
						eagerState: u.eagerState,
						next: null
					}, l === null ? (c = l = f, o = a) : l = l.next = f, L.lanes |= p, Kl |= p;
					f = u.action, bo && n(a, f), a = u.hasEagerState ? u.eagerState : n(a, f);
				} else p = {
					lane: f,
					revertLane: u.revertLane,
					gesture: u.gesture,
					action: u.action,
					hasEagerState: u.hasEagerState,
					eagerState: u.eagerState,
					next: null
				}, l === null ? (c = l = p, o = a) : l = l.next = p, L.lanes |= f, Kl |= f;
				u = u.next;
			} while (u !== null && u !== t);
			if (l === null ? o = a : l.next = c, !kr(a, e.memoizedState) && (ac = !0, d && (n = ba, n !== null))) throw n;
			e.memoizedState = a, e.baseState = o, e.baseQueue = l, r.lastRenderedState = a;
		}
		return i === null && (r.lanes = 0), [e.memoizedState, r.dispatch];
	}
	function Ho(e) {
		var t = Fo(), n = t.queue;
		if (n === null) throw Error(s(311));
		n.lastRenderedReducer = e;
		var r = n.dispatch, i = n.pending, a = t.memoizedState;
		if (i !== null) {
			n.pending = null;
			var o = i = i.next;
			do
				a = e(a, o.action), o = o.next;
			while (o !== i);
			kr(a, t.memoizedState) || (ac = !0), t.memoizedState = a, t.baseQueue === null && (t.baseState = a), n.lastRenderedState = a;
		}
		return [a, r];
	}
	function Uo(e, t, n) {
		var r = L, i = Fo(), a = M;
		if (a) {
			if (n === void 0) throw Error(s(407));
			n = n();
		} else n = t();
		var o = !kr((R || i).memoizedState, n);
		if (o && (i.memoizedState = n, ac = !0), i = i.queue, fs(Ko.bind(null, r, i, e), [e]), i.getSnapshot !== t || o || _o !== null && _o.memoizedState.tag & 1) {
			if (r.flags |= 2048, ls(9, { destroy: void 0 }, Go.bind(null, r, i, n, t), null), K === null) throw Error(s(349));
			a || go & 127 || Wo(r, t, n);
		}
		return n;
	}
	function Wo(e, t, n) {
		e.flags |= 16384, e = {
			getSnapshot: t,
			value: n
		}, t = L.updateQueue, t === null ? (t = Io(), L.updateQueue = t, t.stores = [e]) : (n = t.stores, n === null ? t.stores = [e] : n.push(e));
	}
	function Go(e, t, n, r) {
		t.value = n, t.getSnapshot = r, qo(t) && Jo(e);
	}
	function Ko(e, t, n) {
		return n(function() {
			qo(t) && Jo(e);
		});
	}
	function qo(e) {
		var t = e.getSnapshot;
		e = e.value;
		try {
			var n = t();
			return !kr(e, n);
		} catch {
			return !0;
		}
	}
	function Jo(e) {
		var t = ui(e, 2);
		t !== null && gu(t, e, 2);
	}
	function Yo(e) {
		var t = Po();
		if (typeof e == "function") {
			var n = e;
			if (e = n(), bo) {
				Ke(!0);
				try {
					n();
				} finally {
					Ke(!1);
				}
			}
		}
		return t.memoizedState = t.baseState = e, t.queue = {
			pending: null,
			lanes: 0,
			dispatch: null,
			lastRenderedReducer: Bo,
			lastRenderedState: e
		}, t;
	}
	function Xo(e, t, n, r) {
		return e.baseState = n, Vo(e, R, typeof r == "function" ? r : Bo);
	}
	function Zo(e, t, n, r, i) {
		if (Ls(e)) throw Error(s(485));
		if (e = t.action, e !== null) {
			var a = {
				payload: i,
				action: e,
				next: null,
				isTransition: !0,
				status: "pending",
				value: null,
				reason: null,
				listeners: [],
				then: function(e) {
					a.listeners.push(e);
				}
			};
			E.T === null ? a.isTransition = !1 : n(!0), r(a), n = t.pending, n === null ? (a.next = t.pending = a, Qo(t, a)) : (a.next = n.next, t.pending = n.next = a);
		}
	}
	function Qo(e, t) {
		var n = t.action, r = t.payload, i = e.state;
		if (t.isTransition) {
			var a = E.T, o = {};
			E.T = o;
			try {
				var s = n(i, r), c = E.S;
				c !== null && c(o, s), $o(e, t, s);
			} catch (n) {
				ts(e, t, n);
			} finally {
				a !== null && o.types !== null && (a.types = o.types), E.T = a;
			}
		} else try {
			a = n(i, r), $o(e, t, a);
		} catch (n) {
			ts(e, t, n);
		}
	}
	function $o(e, t, n) {
		typeof n == "object" && n && typeof n.then == "function" ? n.then(function(n) {
			es(e, t, n);
		}, function(n) {
			return ts(e, t, n);
		}) : es(e, t, n);
	}
	function es(e, t, n) {
		t.status = "fulfilled", t.value = n, ns(t), e.state = n, t = e.pending, t !== null && (n = t.next, n === t ? e.pending = null : (n = n.next, t.next = n, Qo(e, n)));
	}
	function ts(e, t, n) {
		var r = e.pending;
		if (e.pending = null, r !== null) {
			r = r.next;
			do
				t.status = "rejected", t.reason = n, ns(t), t = t.next;
			while (t !== r);
		}
		e.action = null;
	}
	function ns(e) {
		e = e.listeners;
		for (var t = 0; t < e.length; t++) (0, e[t])();
	}
	function rs(e, t) {
		return t;
	}
	function is(e, t) {
		if (M) {
			var n = K.formState;
			if (n !== null) {
				a: {
					var r = L;
					if (M) {
						if (Vi) {
							b: {
								for (var i = Vi, a = Ui; i.nodeType !== 8;) {
									if (!a) {
										i = null;
										break b;
									}
									if (i = cf(i.nextSibling), i === null) {
										i = null;
										break b;
									}
								}
								a = i.data, i = a === "F!" || a === "F" ? i : null;
							}
							if (i) {
								Vi = cf(i.nextSibling), r = i.data === "F!";
								break a;
							}
						}
						Gi(r);
					}
					r = !1;
				}
				r && (t = n[0]);
			}
		}
		return n = Po(), n.memoizedState = n.baseState = t, r = {
			pending: null,
			lanes: 0,
			dispatch: null,
			lastRenderedReducer: rs,
			lastRenderedState: t
		}, n.queue = r, n = Ps.bind(null, L, r), r.dispatch = n, r = Yo(!1), a = Is.bind(null, L, !1, r.queue), r = Po(), i = {
			state: t,
			dispatch: null,
			action: e,
			pending: null
		}, r.queue = i, n = Zo.bind(null, L, i, a, n), i.dispatch = n, r.memoizedState = e, [
			t,
			n,
			!1
		];
	}
	function as(e) {
		return os(Fo(), R, e);
	}
	function os(e, t, n) {
		if (t = Vo(e, t, rs)[0], e = z(Bo)[0], typeof t == "object" && t && typeof t.then == "function") try {
			var r = Lo(t);
		} catch (e) {
			throw e === Oa ? Aa : e;
		}
		else r = t;
		t = Fo();
		var i = t.queue, a = i.dispatch;
		return n !== t.memoizedState && (L.flags |= 2048, ls(9, { destroy: void 0 }, ss.bind(null, i, n), null)), [
			r,
			a,
			e
		];
	}
	function ss(e, t) {
		e.action = t;
	}
	function cs(e) {
		var t = Fo(), n = R;
		if (n !== null) return os(t, n, e);
		Fo(), t = t.memoizedState, n = Fo();
		var r = n.queue.dispatch;
		return n.memoizedState = e, [
			t,
			r,
			!1
		];
	}
	function ls(e, t, n, r) {
		return e = {
			tag: e,
			create: n,
			deps: r,
			inst: t,
			next: null
		}, t = L.updateQueue, t === null && (t = Io(), L.updateQueue = t), n = t.lastEffect, n === null ? t.lastEffect = e.next = e : (r = n.next, n.next = e, e.next = r, t.lastEffect = e), e;
	}
	function B() {
		return Fo().memoizedState;
	}
	function us(e, t, n, r) {
		var i = Po();
		L.flags |= e, i.memoizedState = ls(1 | t, { destroy: void 0 }, n, r === void 0 ? null : r);
	}
	function ds(e, t, n, r) {
		var i = Fo();
		r = r === void 0 ? null : r;
		var a = i.memoizedState.inst;
		R !== null && r !== null && Eo(r, R.memoizedState.deps) ? i.memoizedState = ls(t, a, n, r) : (L.flags |= e, i.memoizedState = ls(1 | t, a, n, r));
	}
	function V(e, t) {
		us(8390656, 8, e, t);
	}
	function fs(e, t) {
		ds(2048, 8, e, t);
	}
	function ps(e) {
		L.flags |= 4;
		var t = L.updateQueue;
		if (t === null) t = Io(), L.updateQueue = t, t.events = [e];
		else {
			var n = t.events;
			n === null ? t.events = [e] : n.push(e);
		}
	}
	function ms(e) {
		var t = Fo().memoizedState;
		return ps({
			ref: t,
			nextImpl: e
		}), function() {
			if (G & 2) throw Error(s(440));
			return t.impl.apply(void 0, arguments);
		};
	}
	function hs(e, t) {
		return ds(4, 2, e, t);
	}
	function gs(e, t) {
		return ds(4, 4, e, t);
	}
	function _s(e, t) {
		if (typeof t == "function") {
			e = e();
			var n = t(e);
			return function() {
				typeof n == "function" ? n() : t(null);
			};
		}
		if (t != null) return e = e(), t.current = e, function() {
			t.current = null;
		};
	}
	function vs(e, t, n) {
		n = n == null ? null : n.concat([e]), ds(4, 4, _s.bind(null, t, e), n);
	}
	function ys() {}
	function bs(e, t) {
		var n = Fo();
		t = t === void 0 ? null : t;
		var r = n.memoizedState;
		return t !== null && Eo(t, r[1]) ? r[0] : (n.memoizedState = [e, t], e);
	}
	function xs(e, t) {
		var n = Fo();
		t = t === void 0 ? null : t;
		var r = n.memoizedState;
		if (t !== null && Eo(t, r[1])) return r[0];
		if (r = e(), bo) {
			Ke(!0);
			try {
				e();
			} finally {
				Ke(!1);
			}
		}
		return n.memoizedState = [r, t], r;
	}
	function Ss(e, t, n) {
		return n === void 0 || go & 1073741824 && !(J & 261930) ? e.memoizedState = t : (e.memoizedState = n, e = hu(), L.lanes |= e, Kl |= e, n);
	}
	function Cs(e, t, n, r) {
		return kr(n, t) ? n : ro.current === null ? !(go & 42) || go & 1073741824 && !(J & 261930) ? (ac = !0, e.memoizedState = n) : (e = hu(), L.lanes |= e, Kl |= e, t) : (e = Ss(e, n, r), kr(e, t) || (ac = !0), e);
	}
	function ws(e, t, n, r, i) {
		var a = D.p;
		D.p = a !== 0 && 8 > a ? a : 8;
		var o = E.T, s = {};
		E.T = s, Is(e, !1, t, n);
		try {
			var c = i(), l = E.S;
			l !== null && l(s, c), typeof c == "object" && c && typeof c.then == "function" ? Fs(e, t, Ca(c, r), mu(e)) : Fs(e, t, r, mu(e));
		} catch (n) {
			Fs(e, t, {
				then: function() {},
				status: "rejected",
				reason: n
			}, mu());
		} finally {
			D.p = a, o !== null && s.types !== null && (o.types = s.types), E.T = o;
		}
	}
	function Ts() {}
	function Es(e, t, n, r) {
		if (e.tag !== 5) throw Error(s(476));
		var i = Ds(e).queue;
		ws(e, i, t, ue, n === null ? Ts : function() {
			return Os(e), n(r);
		});
	}
	function Ds(e) {
		var t = e.memoizedState;
		if (t !== null) return t;
		t = {
			memoizedState: ue,
			baseState: ue,
			baseQueue: null,
			queue: {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: Bo,
				lastRenderedState: ue
			},
			next: null
		};
		var n = {};
		return t.next = {
			memoizedState: n,
			baseState: n,
			baseQueue: null,
			queue: {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: Bo,
				lastRenderedState: n
			},
			next: null
		}, e.memoizedState = t, e = e.alternate, e !== null && (e.memoizedState = t), t;
	}
	function Os(e) {
		var t = Ds(e);
		t.next === null && (t = e.alternate.memoizedState), Fs(e, t.next.queue, {}, mu());
	}
	function ks() {
		return ca(Qf);
	}
	function As() {
		return Fo().memoizedState;
	}
	function js() {
		return Fo().memoizedState;
	}
	function Ms(e) {
		for (var t = e.return; t !== null;) {
			switch (t.tag) {
				case 24:
				case 3:
					var n = mu();
					e = Ja(n);
					var r = Ya(t, e, n);
					r !== null && (gu(r, t, n), Xa(r, t, n)), t = { cache: ha() }, e.payload = t;
					return;
			}
			t = t.return;
		}
	}
	function Ns(e, t, n) {
		var r = mu();
		n = {
			lane: r,
			revertLane: 0,
			gesture: null,
			action: n,
			hasEagerState: !1,
			eagerState: null,
			next: null
		}, Ls(e) ? Rs(t, n) : (n = li(e, t, n, r), n !== null && (gu(n, e, r), zs(n, t, r)));
	}
	function Ps(e, t, n) {
		Fs(e, t, n, mu());
	}
	function Fs(e, t, n, r) {
		var i = {
			lane: r,
			revertLane: 0,
			gesture: null,
			action: n,
			hasEagerState: !1,
			eagerState: null,
			next: null
		};
		if (Ls(e)) Rs(t, i);
		else {
			var a = e.alternate;
			if (e.lanes === 0 && (a === null || a.lanes === 0) && (a = t.lastRenderedReducer, a !== null)) try {
				var o = t.lastRenderedState, s = a(o, n);
				if (i.hasEagerState = !0, i.eagerState = s, kr(s, o)) return ci(e, t, i, 0), K === null && si(), !1;
			} catch {}
			if (n = li(e, t, i, r), n !== null) return gu(n, e, r), zs(n, t, r), !0;
		}
		return !1;
	}
	function Is(e, t, n, r) {
		if (r = {
			lane: 2,
			revertLane: fd(),
			gesture: null,
			action: r,
			hasEagerState: !1,
			eagerState: null,
			next: null
		}, Ls(e)) {
			if (t) throw Error(s(479));
		} else t = li(e, n, r, 2), t !== null && gu(t, e, 2);
	}
	function Ls(e) {
		var t = e.alternate;
		return e === L || t !== null && t === L;
	}
	function Rs(e, t) {
		yo = vo = !0;
		var n = e.pending;
		n === null ? t.next = t : (t.next = n.next, n.next = t), e.pending = t;
	}
	function zs(e, t, n) {
		if (n & 4194048) {
			var r = t.lanes;
			r &= e.pendingLanes, n |= r, t.lanes = n, lt(e, n);
		}
	}
	var Bs = {
		readContext: ca,
		use: Ro,
		useCallback: To,
		useContext: To,
		useEffect: To,
		useImperativeHandle: To,
		useLayoutEffect: To,
		useInsertionEffect: To,
		useMemo: To,
		useReducer: To,
		useRef: To,
		useState: To,
		useDebugValue: To,
		useDeferredValue: To,
		useTransition: To,
		useSyncExternalStore: To,
		useId: To,
		useHostTransitionStatus: To,
		useFormState: To,
		useActionState: To,
		useOptimistic: To,
		useMemoCache: To,
		useCacheRefresh: To
	};
	Bs.useEffectEvent = To;
	var Vs = {
		readContext: ca,
		use: Ro,
		useCallback: function(e, t) {
			return Po().memoizedState = [e, t === void 0 ? null : t], e;
		},
		useContext: ca,
		useEffect: V,
		useImperativeHandle: function(e, t, n) {
			n = n == null ? null : n.concat([e]), us(4194308, 4, _s.bind(null, t, e), n);
		},
		useLayoutEffect: function(e, t) {
			return us(4194308, 4, e, t);
		},
		useInsertionEffect: function(e, t) {
			us(4, 2, e, t);
		},
		useMemo: function(e, t) {
			var n = Po();
			t = t === void 0 ? null : t;
			var r = e();
			if (bo) {
				Ke(!0);
				try {
					e();
				} finally {
					Ke(!1);
				}
			}
			return n.memoizedState = [r, t], r;
		},
		useReducer: function(e, t, n) {
			var r = Po();
			if (n !== void 0) {
				var i = n(t);
				if (bo) {
					Ke(!0);
					try {
						n(t);
					} finally {
						Ke(!1);
					}
				}
			} else i = t;
			return r.memoizedState = r.baseState = i, e = {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: e,
				lastRenderedState: i
			}, r.queue = e, e = e.dispatch = Ns.bind(null, L, e), [r.memoizedState, e];
		},
		useRef: function(e) {
			var t = Po();
			return e = { current: e }, t.memoizedState = e;
		},
		useState: function(e) {
			e = Yo(e);
			var t = e.queue, n = Ps.bind(null, L, t);
			return t.dispatch = n, [e.memoizedState, n];
		},
		useDebugValue: ys,
		useDeferredValue: function(e, t) {
			return Ss(Po(), e, t);
		},
		useTransition: function() {
			var e = Yo(!1);
			return e = ws.bind(null, L, e.queue, !0, !1), Po().memoizedState = e, [!1, e];
		},
		useSyncExternalStore: function(e, t, n) {
			var r = L, i = Po();
			if (M) {
				if (n === void 0) throw Error(s(407));
				n = n();
			} else {
				if (n = t(), K === null) throw Error(s(349));
				J & 127 || Wo(r, t, n);
			}
			i.memoizedState = n;
			var a = {
				value: n,
				getSnapshot: t
			};
			return i.queue = a, V(Ko.bind(null, r, a, e), [e]), r.flags |= 2048, ls(9, { destroy: void 0 }, Go.bind(null, r, a, n, t), null), n;
		},
		useId: function() {
			var e = Po(), t = K.identifierPrefix;
			if (M) {
				var n = Pi, r = Ni;
				n = (r & ~(1 << 32 - qe(r) - 1)).toString(32) + n, t = "_" + t + "R_" + n, n = xo++, 0 < n && (t += "H" + n.toString(32)), t += "_";
			} else n = wo++, t = "_" + t + "r_" + n.toString(32) + "_";
			return e.memoizedState = t;
		},
		useHostTransitionStatus: ks,
		useFormState: is,
		useActionState: is,
		useOptimistic: function(e) {
			var t = Po();
			t.memoizedState = t.baseState = e;
			var n = {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: null,
				lastRenderedState: null
			};
			return t.queue = n, t = Is.bind(null, L, !0, n), n.dispatch = t, [e, t];
		},
		useMemoCache: zo,
		useCacheRefresh: function() {
			return Po().memoizedState = Ms.bind(null, L);
		},
		useEffectEvent: function(e) {
			var t = Po(), n = { impl: e };
			return t.memoizedState = n, function() {
				if (G & 2) throw Error(s(440));
				return n.impl.apply(void 0, arguments);
			};
		}
	}, Hs = {
		readContext: ca,
		use: Ro,
		useCallback: bs,
		useContext: ca,
		useEffect: fs,
		useImperativeHandle: vs,
		useInsertionEffect: hs,
		useLayoutEffect: gs,
		useMemo: xs,
		useReducer: z,
		useRef: B,
		useState: function() {
			return z(Bo);
		},
		useDebugValue: ys,
		useDeferredValue: function(e, t) {
			return Cs(Fo(), R.memoizedState, e, t);
		},
		useTransition: function() {
			var e = z(Bo)[0], t = Fo().memoizedState;
			return [typeof e == "boolean" ? e : Lo(e), t];
		},
		useSyncExternalStore: Uo,
		useId: As,
		useHostTransitionStatus: ks,
		useFormState: as,
		useActionState: as,
		useOptimistic: function(e, t) {
			return Xo(Fo(), R, e, t);
		},
		useMemoCache: zo,
		useCacheRefresh: js
	};
	Hs.useEffectEvent = ms;
	var Us = {
		readContext: ca,
		use: Ro,
		useCallback: bs,
		useContext: ca,
		useEffect: fs,
		useImperativeHandle: vs,
		useInsertionEffect: hs,
		useLayoutEffect: gs,
		useMemo: xs,
		useReducer: Ho,
		useRef: B,
		useState: function() {
			return Ho(Bo);
		},
		useDebugValue: ys,
		useDeferredValue: function(e, t) {
			var n = Fo();
			return R === null ? Ss(n, e, t) : Cs(n, R.memoizedState, e, t);
		},
		useTransition: function() {
			var e = Ho(Bo)[0], t = Fo().memoizedState;
			return [typeof e == "boolean" ? e : Lo(e), t];
		},
		useSyncExternalStore: Uo,
		useId: As,
		useHostTransitionStatus: ks,
		useFormState: cs,
		useActionState: cs,
		useOptimistic: function(e, t) {
			var n = Fo();
			return R === null ? (n.baseState = e, [e, n.queue.dispatch]) : Xo(n, R, e, t);
		},
		useMemoCache: zo,
		useCacheRefresh: js
	};
	Us.useEffectEvent = ms;
	function Ws(e, t, n, r) {
		t = e.memoizedState, n = n(r, t), n = n == null ? t : h({}, t, n), e.memoizedState = n, e.lanes === 0 && (e.updateQueue.baseState = n);
	}
	var Gs = {
		enqueueSetState: function(e, t, n) {
			e = e._reactInternals;
			var r = mu(), i = Ja(r);
			i.payload = t, n != null && (i.callback = n), t = Ya(e, i, r), t !== null && (gu(t, e, r), Xa(t, e, r));
		},
		enqueueReplaceState: function(e, t, n) {
			e = e._reactInternals;
			var r = mu(), i = Ja(r);
			i.tag = 1, i.payload = t, n != null && (i.callback = n), t = Ya(e, i, r), t !== null && (gu(t, e, r), Xa(t, e, r));
		},
		enqueueForceUpdate: function(e, t) {
			e = e._reactInternals;
			var n = mu(), r = Ja(n);
			r.tag = 2, t != null && (r.callback = t), t = Ya(e, r, n), t !== null && (gu(t, e, n), Xa(t, e, n));
		}
	};
	function Ks(e, t, n, r, i, a, o) {
		return e = e.stateNode, typeof e.shouldComponentUpdate == "function" ? e.shouldComponentUpdate(r, a, o) : t.prototype && t.prototype.isPureReactComponent ? !Ar(n, r) || !Ar(i, a) : !0;
	}
	function qs(e, t, n, r) {
		e = t.state, typeof t.componentWillReceiveProps == "function" && t.componentWillReceiveProps(n, r), typeof t.UNSAFE_componentWillReceiveProps == "function" && t.UNSAFE_componentWillReceiveProps(n, r), t.state !== e && Gs.enqueueReplaceState(t, t.state, null);
	}
	function Js(e, t) {
		var n = t;
		if ("ref" in t) for (var r in n = {}, t) r !== "ref" && (n[r] = t[r]);
		if (e = e.defaultProps) for (var i in n === t && (n = h({}, n)), e) n[i] === void 0 && (n[i] = e[i]);
		return n;
	}
	function Ys(e) {
		ri(e);
	}
	function Xs(e) {
		console.error(e);
	}
	function Zs(e) {
		ri(e);
	}
	function Qs(e, t) {
		try {
			var n = e.onUncaughtError;
			n(t.value, { componentStack: t.stack });
		} catch (e) {
			setTimeout(function() {
				throw e;
			});
		}
	}
	function $s(e, t, n) {
		try {
			var r = e.onCaughtError;
			r(n.value, {
				componentStack: n.stack,
				errorBoundary: t.tag === 1 ? t.stateNode : null
			});
		} catch (e) {
			setTimeout(function() {
				throw e;
			});
		}
	}
	function ec(e, t, n) {
		return n = Ja(n), n.tag = 3, n.payload = { element: null }, n.callback = function() {
			Qs(e, t);
		}, n;
	}
	function tc(e) {
		return e = Ja(e), e.tag = 3, e;
	}
	function nc(e, t, n, r) {
		var i = n.type.getDerivedStateFromError;
		if (typeof i == "function") {
			var a = r.value;
			e.payload = function() {
				return i(a);
			}, e.callback = function() {
				$s(t, n, r);
			};
		}
		var o = n.stateNode;
		o !== null && typeof o.componentDidCatch == "function" && (e.callback = function() {
			$s(t, n, r), typeof i != "function" && (iu === null ? iu = /* @__PURE__ */ new Set([this]) : iu.add(this));
			var e = r.stack;
			this.componentDidCatch(r.value, { componentStack: e === null ? "" : e });
		});
	}
	function rc(e, t, n, r, i) {
		if (n.flags |= 32768, typeof r == "object" && r && typeof r.then == "function") {
			if (t = n.alternate, t !== null && aa(t, n, i, !0), n = co.current, n !== null) {
				switch (n.tag) {
					case 31:
					case 13: return lo === null ? Ou() : n.alternate === null && Gl === 0 && (Gl = 3), n.flags &= -257, n.flags |= 65536, n.lanes = i, r === ja ? n.flags |= 16384 : (t = n.updateQueue, t === null ? n.updateQueue = /* @__PURE__ */ new Set([r]) : t.add(r), Ku(e, r, i)), !1;
					case 22: return n.flags |= 65536, r === ja ? n.flags |= 16384 : (t = n.updateQueue, t === null ? (t = {
						transitions: null,
						markerInstances: null,
						retryQueue: /* @__PURE__ */ new Set([r])
					}, n.updateQueue = t) : (n = t.retryQueue, n === null ? t.retryQueue = /* @__PURE__ */ new Set([r]) : n.add(r)), Ku(e, r, i)), !1;
				}
				throw Error(s(435, n.tag));
			}
			return Ku(e, r, i), Ou(), !1;
		}
		if (M) return t = co.current, t === null ? (r !== Wi && (t = Error(s(423), { cause: r }), Zi(Ti(t, n))), e = e.current.alternate, e.flags |= 65536, i &= -i, e.lanes |= i, r = Ti(r, n), i = ec(e.stateNode, r, i), Za(e, i), Gl !== 4 && (Gl = 2)) : (!(t.flags & 65536) && (t.flags |= 256), t.flags |= 65536, t.lanes = i, r !== Wi && (e = Error(s(422), { cause: r }), Zi(Ti(e, n)))), !1;
		var a = Error(s(520), { cause: r });
		if (a = Ti(a, n), Zl === null ? Zl = [a] : Zl.push(a), Gl !== 4 && (Gl = 2), t === null) return !0;
		r = Ti(r, n), n = t;
		do {
			switch (n.tag) {
				case 3: return n.flags |= 65536, e = i & -i, n.lanes |= e, e = ec(n.stateNode, r, e), Za(n, e), !1;
				case 1: if (t = n.type, a = n.stateNode, !(n.flags & 128) && (typeof t.getDerivedStateFromError == "function" || a !== null && typeof a.componentDidCatch == "function" && (iu === null || !iu.has(a)))) return n.flags |= 65536, i &= -i, n.lanes |= i, i = tc(i), nc(i, e, n, r), Za(n, i), !1;
			}
			n = n.return;
		} while (n !== null);
		return !1;
	}
	var ic = Error(s(461)), ac = !1;
	function oc(e, t, n, r) {
		t.child = e === null ? Wa(t, null, n, r) : Ua(t, e.child, n, r);
	}
	function sc(e, t, n, r, i) {
		n = n.render;
		var a = t.ref;
		if ("ref" in r) {
			var o = {};
			for (var s in r) s !== "ref" && (o[s] = r[s]);
		} else o = r;
		return sa(t), r = Do(e, t, n, o, a, i), s = jo(), e !== null && !ac ? (Mo(e, t, i), Ac(e, t, i)) : (M && s && Li(t), t.flags |= 1, oc(e, t, r, i), t.child);
	}
	function cc(e, t, n, r, i) {
		if (e === null) {
			var a = n.type;
			return typeof a == "function" && !gi(a) && a.defaultProps === void 0 && n.compare === null ? (t.tag = 15, t.type = a, lc(e, t, a, r, i)) : (e = yi(n.type, null, r, t, t.mode, i), e.ref = t.ref, e.return = t, t.child = e);
		}
		if (a = e.child, !jc(e, i)) {
			var o = a.memoizedProps;
			if (n = n.compare, n = n === null ? Ar : n, n(o, r) && e.ref === t.ref) return Ac(e, t, i);
		}
		return t.flags |= 1, e = _i(a, r), e.ref = t.ref, e.return = t, t.child = e;
	}
	function lc(e, t, n, r, i) {
		if (e !== null) {
			var a = e.memoizedProps;
			if (Ar(a, r) && e.ref === t.ref) {
				if (ac = !1, t.pendingProps = r = a, jc(e, i)) e.flags & 131072 && (ac = !0);
				else return t.lanes = e.lanes, Ac(e, t, i);
			}
		}
		return _c(e, t, n, r, i);
	}
	function uc(e, t, n, r) {
		var i = r.children, a = e === null ? null : e.memoizedState;
		if (e === null && t.stateNode === null && (t.stateNode = {
			_visibility: 1,
			_pendingMarkers: null,
			_retryCache: null,
			_transitions: null
		}), r.mode === "hidden") {
			if (t.flags & 128) {
				if (a = a === null ? n : a.baseLanes | n, e !== null) {
					for (r = t.child = e.child, i = 0; r !== null;) i = i | r.lanes | r.childLanes, r = r.sibling;
					r = i & ~a;
				} else r = 0, t.child = null;
				return fc(e, t, a, n, r);
			}
			if (n & 536870912) t.memoizedState = {
				baseLanes: 0,
				cachePool: null
			}, e !== null && Da(t, a === null ? null : a.cachePool), a === null ? oo() : ao(t, a), F(t);
			else return r = t.lanes = 536870912, fc(e, t, a === null ? n : a.baseLanes | n, n, r);
		} else a === null ? (e !== null && Da(t, null), oo(), po(t)) : (Da(t, a.cachePool), ao(t, a), po(t), t.memoizedState = null);
		return oc(e, t, i, n), t.child;
	}
	function dc(e, t) {
		return e !== null && e.tag === 22 || t.stateNode !== null || (t.stateNode = {
			_visibility: 1,
			_pendingMarkers: null,
			_retryCache: null,
			_transitions: null
		}), t.sibling;
	}
	function fc(e, t, n, r, i) {
		var a = Ea();
		return a = a === null ? null : {
			parent: ma._currentValue,
			pool: a
		}, t.memoizedState = {
			baseLanes: n,
			cachePool: a
		}, e !== null && Da(t, null), oo(), F(t), e !== null && aa(e, t, r, !0), t.childLanes = i, null;
	}
	function pc(e, t) {
		return t = H({
			mode: t.mode,
			children: t.children
		}, e.mode), t.ref = e.ref, e.child = t, t.return = e, t;
	}
	function mc(e, t, n) {
		return Ua(t, e.child, null, n), e = pc(t, t.pendingProps), e.flags |= 2, mo(t), t.memoizedState = null, e;
	}
	function hc(e, t, n) {
		var r = t.pendingProps, i = !!(t.flags & 128);
		if (t.flags &= -129, e === null) {
			if (M) {
				if (r.mode === "hidden") return e = pc(t, r), t.lanes = 536870912, dc(null, e);
				if (fo(t), (e = Vi) ? (e = rf(e, Ui), e = e !== null && e.data === "&" ? e : null, e !== null && (t.memoizedState = {
					dehydrated: e,
					treeContext: Mi === null ? null : {
						id: Ni,
						overflow: Pi
					},
					retryLane: 536870912,
					hydrationErrors: null
				}, n = Si(e), n.return = t, t.child = n, Bi = t, Vi = null)) : e = null, e === null) throw Gi(t);
				return t.lanes = 536870912, null;
			}
			return pc(t, r);
		}
		var a = e.memoizedState;
		if (a !== null) {
			var o = a.dehydrated;
			if (fo(t), i) {
				if (t.flags & 256) t.flags &= -257, t = mc(e, t, n);
				else if (t.memoizedState !== null) t.child = e.child, t.flags |= 128, t = null;
				else throw Error(s(558));
			} else if (ac || aa(e, t, n, !1), i = (n & e.childLanes) !== 0, ac || i) {
				if (r = K, r !== null && (o = ut(r, n), o !== 0 && o !== a.retryLane)) throw a.retryLane = o, ui(e, o), gu(r, e, o), ic;
				Ou(), t = mc(e, t, n);
			} else e = a.treeContext, Vi = cf(o.nextSibling), Bi = t, M = !0, Hi = null, Ui = !1, e !== null && zi(t, e), t = pc(t, r), t.flags |= 4096;
			return t;
		}
		return e = _i(e.child, {
			mode: r.mode,
			children: r.children
		}), e.ref = t.ref, t.child = e, e.return = t, e;
	}
	function gc(e, t) {
		var n = t.ref;
		if (n === null) e !== null && e.ref !== null && (t.flags |= 4194816);
		else {
			if (typeof n != "function" && typeof n != "object") throw Error(s(284));
			(e === null || e.ref !== n) && (t.flags |= 4194816);
		}
	}
	function _c(e, t, n, r, i) {
		return sa(t), n = Do(e, t, n, r, void 0, i), r = jo(), e !== null && !ac ? (Mo(e, t, i), Ac(e, t, i)) : (M && r && Li(t), t.flags |= 1, oc(e, t, n, i), t.child);
	}
	function vc(e, t, n, r, i, a) {
		return sa(t), t.updateQueue = null, n = ko(t, r, n, i), Oo(e), r = jo(), e !== null && !ac ? (Mo(e, t, a), Ac(e, t, a)) : (M && r && Li(t), t.flags |= 1, oc(e, t, n, a), t.child);
	}
	function yc(e, t, n, r, i) {
		if (sa(t), t.stateNode === null) {
			var a = pi, o = n.contextType;
			typeof o == "object" && o && (a = ca(o)), a = new n(r, a), t.memoizedState = a.state !== null && a.state !== void 0 ? a.state : null, a.updater = Gs, t.stateNode = a, a._reactInternals = t, a = t.stateNode, a.props = r, a.state = t.memoizedState, a.refs = {}, Ka(t), o = n.contextType, a.context = typeof o == "object" && o ? ca(o) : pi, a.state = t.memoizedState, o = n.getDerivedStateFromProps, typeof o == "function" && (Ws(t, n, o, r), a.state = t.memoizedState), typeof n.getDerivedStateFromProps == "function" || typeof a.getSnapshotBeforeUpdate == "function" || typeof a.UNSAFE_componentWillMount != "function" && typeof a.componentWillMount != "function" || (o = a.state, typeof a.componentWillMount == "function" && a.componentWillMount(), typeof a.UNSAFE_componentWillMount == "function" && a.UNSAFE_componentWillMount(), o !== a.state && Gs.enqueueReplaceState(a, a.state, null), eo(t, r, a, i), $a(), a.state = t.memoizedState), typeof a.componentDidMount == "function" && (t.flags |= 4194308), r = !0;
		} else if (e === null) {
			a = t.stateNode;
			var s = t.memoizedProps, c = Js(n, s);
			a.props = c;
			var l = a.context, u = n.contextType;
			o = pi, typeof u == "object" && u && (o = ca(u));
			var d = n.getDerivedStateFromProps;
			u = typeof d == "function" || typeof a.getSnapshotBeforeUpdate == "function", s = t.pendingProps !== s, u || typeof a.UNSAFE_componentWillReceiveProps != "function" && typeof a.componentWillReceiveProps != "function" || (s || l !== o) && qs(t, a, r, o), Ga = !1;
			var f = t.memoizedState;
			a.state = f, eo(t, r, a, i), $a(), l = t.memoizedState, s || f !== l || Ga ? (typeof d == "function" && (Ws(t, n, d, r), l = t.memoizedState), (c = Ga || Ks(t, n, c, r, f, l, o)) ? (u || typeof a.UNSAFE_componentWillMount != "function" && typeof a.componentWillMount != "function" || (typeof a.componentWillMount == "function" && a.componentWillMount(), typeof a.UNSAFE_componentWillMount == "function" && a.UNSAFE_componentWillMount()), typeof a.componentDidMount == "function" && (t.flags |= 4194308)) : (typeof a.componentDidMount == "function" && (t.flags |= 4194308), t.memoizedProps = r, t.memoizedState = l), a.props = r, a.state = l, a.context = o, r = c) : (typeof a.componentDidMount == "function" && (t.flags |= 4194308), r = !1);
		} else {
			a = t.stateNode, qa(e, t), o = t.memoizedProps, u = Js(n, o), a.props = u, d = t.pendingProps, f = a.context, l = n.contextType, c = pi, typeof l == "object" && l && (c = ca(l)), s = n.getDerivedStateFromProps, (l = typeof s == "function" || typeof a.getSnapshotBeforeUpdate == "function") || typeof a.UNSAFE_componentWillReceiveProps != "function" && typeof a.componentWillReceiveProps != "function" || (o !== d || f !== c) && qs(t, a, r, c), Ga = !1, f = t.memoizedState, a.state = f, eo(t, r, a, i), $a();
			var p = t.memoizedState;
			o !== d || f !== p || Ga || e !== null && e.dependencies !== null && oa(e.dependencies) ? (typeof s == "function" && (Ws(t, n, s, r), p = t.memoizedState), (u = Ga || Ks(t, n, u, r, f, p, c) || e !== null && e.dependencies !== null && oa(e.dependencies)) ? (l || typeof a.UNSAFE_componentWillUpdate != "function" && typeof a.componentWillUpdate != "function" || (typeof a.componentWillUpdate == "function" && a.componentWillUpdate(r, p, c), typeof a.UNSAFE_componentWillUpdate == "function" && a.UNSAFE_componentWillUpdate(r, p, c)), typeof a.componentDidUpdate == "function" && (t.flags |= 4), typeof a.getSnapshotBeforeUpdate == "function" && (t.flags |= 1024)) : (typeof a.componentDidUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 4), typeof a.getSnapshotBeforeUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 1024), t.memoizedProps = r, t.memoizedState = p), a.props = r, a.state = p, a.context = c, r = u) : (typeof a.componentDidUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 4), typeof a.getSnapshotBeforeUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 1024), r = !1);
		}
		return a = r, gc(e, t), r = !!(t.flags & 128), a || r ? (a = t.stateNode, n = r && typeof n.getDerivedStateFromError != "function" ? null : a.render(), t.flags |= 1, e !== null && r ? (t.child = Ua(t, e.child, null, i), t.child = Ua(t, null, n, i)) : oc(e, t, n, i), t.memoizedState = a.state, e = t.child) : e = Ac(e, t, i), e;
	}
	function bc(e, t, n, r) {
		return Yi(), t.flags |= 256, oc(e, t, n, r), t.child;
	}
	var xc = {
		dehydrated: null,
		treeContext: null,
		retryLane: 0,
		hydrationErrors: null
	};
	function Sc(e) {
		return {
			baseLanes: e,
			cachePool: N()
		};
	}
	function Cc(e, t, n) {
		return e = e === null ? 0 : e.childLanes & ~n, t && (e |= Yl), e;
	}
	function wc(e, t, n) {
		var r = t.pendingProps, i = !1, a = !!(t.flags & 128), o;
		if ((o = a) || (o = e !== null && e.memoizedState === null ? !1 : !!(I.current & 2)), o && (i = !0, t.flags &= -129), o = !!(t.flags & 32), t.flags &= -33, e === null) {
			if (M) {
				if (i ? uo(t) : po(t), (e = Vi) ? (e = rf(e, Ui), e = e !== null && e.data !== "&" ? e : null, e !== null && (t.memoizedState = {
					dehydrated: e,
					treeContext: Mi === null ? null : {
						id: Ni,
						overflow: Pi
					},
					retryLane: 536870912,
					hydrationErrors: null
				}, n = Si(e), n.return = t, t.child = n, Bi = t, Vi = null)) : e = null, e === null) throw Gi(t);
				return of(e) ? t.lanes = 32 : t.lanes = 536870912, null;
			}
			var c = r.children;
			return r = r.fallback, i ? (po(t), i = t.mode, c = H({
				mode: "hidden",
				children: c
			}, i), r = bi(r, i, n, null), c.return = t, r.return = t, c.sibling = r, t.child = c, r = t.child, r.memoizedState = Sc(n), r.childLanes = Cc(e, o, n), t.memoizedState = xc, dc(null, r)) : (uo(t), Tc(t, c));
		}
		var l = e.memoizedState;
		if (l !== null && (c = l.dehydrated, c !== null)) {
			if (a) t.flags & 256 ? (uo(t), t.flags &= -257, t = Ec(e, t, n)) : t.memoizedState === null ? (po(t), c = r.fallback, i = t.mode, r = H({
				mode: "visible",
				children: r.children
			}, i), c = bi(c, i, n, null), c.flags |= 2, r.return = t, c.return = t, r.sibling = c, t.child = r, Ua(t, e.child, null, n), r = t.child, r.memoizedState = Sc(n), r.childLanes = Cc(e, o, n), t.memoizedState = xc, t = dc(null, r)) : (po(t), t.child = e.child, t.flags |= 128, t = null);
			else if (uo(t), of(c)) {
				if (o = c.nextSibling && c.nextSibling.dataset, o) var u = o.dgst;
				o = u, r = Error(s(419)), r.stack = "", r.digest = o, Zi({
					value: r,
					source: null,
					stack: null
				}), t = Ec(e, t, n);
			} else if (ac || aa(e, t, n, !1), o = (n & e.childLanes) !== 0, ac || o) {
				if (o = K, o !== null && (r = ut(o, n), r !== 0 && r !== l.retryLane)) throw l.retryLane = r, ui(e, r), gu(o, e, r), ic;
				af(c) || Ou(), t = Ec(e, t, n);
			} else af(c) ? (t.flags |= 192, t.child = e.child, t = null) : (e = l.treeContext, Vi = cf(c.nextSibling), Bi = t, M = !0, Hi = null, Ui = !1, e !== null && zi(t, e), t = Tc(t, r.children), t.flags |= 4096);
			return t;
		}
		return i ? (po(t), c = r.fallback, i = t.mode, l = e.child, u = l.sibling, r = _i(l, {
			mode: "hidden",
			children: r.children
		}), r.subtreeFlags = l.subtreeFlags & 65011712, u === null ? (c = bi(c, i, n, null), c.flags |= 2) : c = _i(u, c), c.return = t, r.return = t, r.sibling = c, t.child = r, dc(null, r), r = t.child, c = e.child.memoizedState, c === null ? c = Sc(n) : (i = c.cachePool, i === null ? i = N() : (l = ma._currentValue, i = i.parent === l ? i : {
			parent: l,
			pool: l
		}), c = {
			baseLanes: c.baseLanes | n,
			cachePool: i
		}), r.memoizedState = c, r.childLanes = Cc(e, o, n), t.memoizedState = xc, dc(e.child, r)) : (uo(t), n = e.child, e = n.sibling, n = _i(n, {
			mode: "visible",
			children: r.children
		}), n.return = t, n.sibling = null, e !== null && (o = t.deletions, o === null ? (t.deletions = [e], t.flags |= 16) : o.push(e)), t.child = n, t.memoizedState = null, n);
	}
	function Tc(e, t) {
		return t = H({
			mode: "visible",
			children: t
		}, e.mode), t.return = e, e.child = t;
	}
	function H(e, t) {
		return e = hi(22, e, null, t), e.lanes = 0, e;
	}
	function Ec(e, t, n) {
		return Ua(t, e.child, null, n), e = Tc(t, t.pendingProps.children), e.flags |= 2, t.memoizedState = null, e;
	}
	function Dc(e, t, n) {
		e.lanes |= t;
		var r = e.alternate;
		r !== null && (r.lanes |= t), ra(e.return, t, n);
	}
	function Oc(e, t, n, r, i, a) {
		var o = e.memoizedState;
		o === null ? e.memoizedState = {
			isBackwards: t,
			rendering: null,
			renderingStartTime: 0,
			last: r,
			tail: n,
			tailMode: i,
			treeForkCount: a
		} : (o.isBackwards = t, o.rendering = null, o.renderingStartTime = 0, o.last = r, o.tail = n, o.tailMode = i, o.treeForkCount = a);
	}
	function kc(e, t, n) {
		var r = t.pendingProps, i = r.revealOrder, a = r.tail;
		r = r.children;
		var o = I.current, s = !!(o & 2);
		if (s ? (o = o & 1 | 2, t.flags |= 128) : o &= 1, O(I, o), oc(e, t, r, n), r = M ? ki : 0, !s && e !== null && e.flags & 128) a: for (e = t.child; e !== null;) {
			if (e.tag === 13) e.memoizedState !== null && Dc(e, n, t);
			else if (e.tag === 19) Dc(e, n, t);
			else if (e.child !== null) {
				e.child.return = e, e = e.child;
				continue;
			}
			if (e === t) break a;
			for (; e.sibling === null;) {
				if (e.return === null || e.return === t) break a;
				e = e.return;
			}
			e.sibling.return = e.return, e = e.sibling;
		}
		switch (i) {
			case "forwards":
				for (n = t.child, i = null; n !== null;) e = n.alternate, e !== null && ho(e) === null && (i = n), n = n.sibling;
				n = i, n === null ? (i = t.child, t.child = null) : (i = n.sibling, n.sibling = null), Oc(t, !1, i, n, a, r);
				break;
			case "backwards":
			case "unstable_legacy-backwards":
				for (n = null, i = t.child, t.child = null; i !== null;) {
					if (e = i.alternate, e !== null && ho(e) === null) {
						t.child = i;
						break;
					}
					e = i.sibling, i.sibling = n, n = i, i = e;
				}
				Oc(t, !0, n, null, a, r);
				break;
			case "together":
				Oc(t, !1, null, null, void 0, r);
				break;
			default: t.memoizedState = null;
		}
		return t.child;
	}
	function Ac(e, t, n) {
		if (e !== null && (t.dependencies = e.dependencies), Kl |= t.lanes, (n & t.childLanes) === 0) {
			if (e !== null) {
				if (aa(e, t, n, !1), (n & t.childLanes) === 0) return null;
			} else return null;
		}
		if (e !== null && t.child !== e.child) throw Error(s(153));
		if (t.child !== null) {
			for (e = t.child, n = _i(e, e.pendingProps), t.child = n, n.return = t; e.sibling !== null;) e = e.sibling, n = n.sibling = _i(e, e.pendingProps), n.return = t;
			n.sibling = null;
		}
		return t.child;
	}
	function jc(e, t) {
		return (e.lanes & t) !== 0 || (e = e.dependencies, !!(e !== null && oa(e)));
	}
	function Mc(e, t, n) {
		switch (t.tag) {
			case 3:
				ye(t, t.stateNode.containerInfo), ta(t, ma, e.memoizedState.cache), Yi();
				break;
			case 27:
			case 5:
				xe(t);
				break;
			case 4:
				ye(t, t.stateNode.containerInfo);
				break;
			case 10:
				ta(t, t.type, t.memoizedProps.value);
				break;
			case 31:
				if (t.memoizedState !== null) return t.flags |= 128, fo(t), null;
				break;
			case 13:
				var r = t.memoizedState;
				if (r !== null) return r.dehydrated === null ? (n & t.child.childLanes) === 0 ? (uo(t), e = Ac(e, t, n), e === null ? null : e.sibling) : wc(e, t, n) : (uo(t), t.flags |= 128, null);
				uo(t);
				break;
			case 19:
				var i = !!(e.flags & 128);
				if (r = (n & t.childLanes) !== 0, r ||= (aa(e, t, n, !1), (n & t.childLanes) !== 0), i) {
					if (r) return kc(e, t, n);
					t.flags |= 128;
				}
				if (i = t.memoizedState, i !== null && (i.rendering = null, i.tail = null, i.lastEffect = null), O(I, I.current), r) break;
				return null;
			case 22: return t.lanes = 0, uc(e, t, n, t.pendingProps);
			case 24: ta(t, ma, e.memoizedState.cache);
		}
		return Ac(e, t, n);
	}
	function Nc(e, t, n) {
		if (e !== null) {
			if (e.memoizedProps !== t.pendingProps) ac = !0;
			else {
				if (!jc(e, n) && !(t.flags & 128)) return ac = !1, Mc(e, t, n);
				ac = !!(e.flags & 131072);
			}
		} else ac = !1, M && t.flags & 1048576 && Ii(t, ki, t.index);
		switch (t.lanes = 0, t.tag) {
			case 16:
				a: {
					var r = t.pendingProps;
					if (e = Pa(t.elementType), t.type = e, typeof e == "function") gi(e) ? (r = Js(e, r), t.tag = 1, t = yc(null, t, e, r, n)) : (t.tag = 0, t = _c(null, t, e, r, n));
					else {
						if (e != null) {
							var i = e.$$typeof;
							if (i === w) {
								t.tag = 11, t = sc(null, t, e, r, n);
								break a;
							}
							if (i === ne) {
								t.tag = 14, t = cc(null, t, e, r, n);
								break a;
							}
						}
						throw t = T(e) || e, Error(s(306, t, ""));
					}
				}
				return t;
			case 0: return _c(e, t, t.type, t.pendingProps, n);
			case 1: return r = t.type, i = Js(r, t.pendingProps), yc(e, t, r, i, n);
			case 3:
				a: {
					if (ye(t, t.stateNode.containerInfo), e === null) throw Error(s(387));
					r = t.pendingProps;
					var a = t.memoizedState;
					i = a.element, qa(e, t), eo(t, r, null, n);
					var o = t.memoizedState;
					if (r = o.cache, ta(t, ma, r), r !== a.cache && ia(t, [ma], n, !0), $a(), r = o.element, a.isDehydrated) {
						if (a = {
							element: r,
							isDehydrated: !1,
							cache: o.cache
						}, t.updateQueue.baseState = a, t.memoizedState = a, t.flags & 256) {
							t = bc(e, t, r, n);
							break a;
						}
						if (r !== i) {
							i = Ti(Error(s(424)), t), Zi(i), t = bc(e, t, r, n);
							break a;
						}
						switch (e = t.stateNode.containerInfo, e.nodeType) {
							case 9:
								e = e.body;
								break;
							default: e = e.nodeName === "HTML" ? e.ownerDocument.body : e;
						}
						for (Vi = cf(e.firstChild), Bi = t, M = !0, Hi = null, Ui = !0, n = Wa(t, null, r, n), t.child = n; n;) n.flags = n.flags & -3 | 4096, n = n.sibling;
					} else {
						if (Yi(), r === i) {
							t = Ac(e, t, n);
							break a;
						}
						oc(e, t, r, n);
					}
					t = t.child;
				}
				return t;
			case 26: return gc(e, t), e === null ? (n = kf(t.type, null, t.pendingProps, null)) ? t.memoizedState = n : M || (n = t.type, e = t.pendingProps, r = Bd(_e.current).createElement(n), r[gt] = t, r[_t] = e, $(r, n, e), kt(r), t.stateNode = r) : t.memoizedState = kf(t.type, e.memoizedProps, t.pendingProps, e.memoizedState), null;
			case 27: return xe(t), e === null && M && (r = t.stateNode = ff(t.type, t.pendingProps, _e.current), Bi = t, Ui = !0, i = Vi, Zd(t.type) ? (lf = i, Vi = cf(r.firstChild)) : Vi = i), oc(e, t, t.pendingProps.children, n), gc(e, t), e === null && (t.flags |= 4194304), t.child;
			case 5: return e === null && M && ((i = r = Vi) && (r = tf(r, t.type, t.pendingProps, Ui), r === null ? i = !1 : (t.stateNode = r, Bi = t, Vi = cf(r.firstChild), Ui = !1, i = !0)), i || Gi(t)), xe(t), i = t.type, a = t.pendingProps, o = e === null ? null : e.memoizedProps, r = a.children, Ud(i, a) ? r = null : o !== null && Ud(i, o) && (t.flags |= 32), t.memoizedState !== null && (i = Do(e, t, Ao, null, null, n), Qf._currentValue = i), gc(e, t), oc(e, t, r, n), t.child;
			case 6: return e === null && M && ((e = n = Vi) && (n = nf(n, t.pendingProps, Ui), n === null ? e = !1 : (t.stateNode = n, Bi = t, Vi = null, e = !0)), e || Gi(t)), null;
			case 13: return wc(e, t, n);
			case 4: return ye(t, t.stateNode.containerInfo), r = t.pendingProps, e === null ? t.child = Ua(t, null, r, n) : oc(e, t, r, n), t.child;
			case 11: return sc(e, t, t.type, t.pendingProps, n);
			case 7: return oc(e, t, t.pendingProps, n), t.child;
			case 8: return oc(e, t, t.pendingProps.children, n), t.child;
			case 12: return oc(e, t, t.pendingProps.children, n), t.child;
			case 10: return r = t.pendingProps, ta(t, t.type, r.value), oc(e, t, r.children, n), t.child;
			case 9: return i = t.type._context, r = t.pendingProps.children, sa(t), i = ca(i), r = r(i), t.flags |= 1, oc(e, t, r, n), t.child;
			case 14: return cc(e, t, t.type, t.pendingProps, n);
			case 15: return lc(e, t, t.type, t.pendingProps, n);
			case 19: return kc(e, t, n);
			case 31: return hc(e, t, n);
			case 22: return uc(e, t, n, t.pendingProps);
			case 24: return sa(t), r = ca(ma), e === null ? (i = Ea(), i === null && (i = K, a = ha(), i.pooledCache = a, a.refCount++, a !== null && (i.pooledCacheLanes |= n), i = a), t.memoizedState = {
				parent: r,
				cache: i
			}, Ka(t), ta(t, ma, i)) : ((e.lanes & n) !== 0 && (qa(e, t), eo(t, null, null, n), $a()), i = e.memoizedState, a = t.memoizedState, i.parent === r ? (r = a.cache, ta(t, ma, r), r !== i.cache && ia(t, [ma], n, !0)) : (i = {
				parent: r,
				cache: r
			}, t.memoizedState = i, t.lanes === 0 && (t.memoizedState = t.updateQueue.baseState = i), ta(t, ma, r))), oc(e, t, t.pendingProps.children, n), t.child;
			case 29: throw t.pendingProps;
		}
		throw Error(s(156, t.tag));
	}
	function Pc(e) {
		e.flags |= 4;
	}
	function Fc(e, t, n, r, i) {
		if ((t = !!(e.mode & 32)) && (t = !1), t) {
			if (e.flags |= 16777216, (i & 335544128) === i) {
				if (e.stateNode.complete) e.flags |= 8192;
				else if (Tu()) e.flags |= 8192;
				else throw Fa = ja, ka;
			}
		} else e.flags &= -16777217;
	}
	function Ic(e, t) {
		if (t.type !== "stylesheet" || t.state.loading & 4) e.flags &= -16777217;
		else if (e.flags |= 16777216, !Wf(t)) {
			if (Tu()) e.flags |= 8192;
			else throw Fa = ja, ka;
		}
	}
	function Lc(e, t) {
		t !== null && (e.flags |= 4), e.flags & 16384 && (t = e.tag === 22 ? 536870912 : it(), e.lanes |= t, Xl |= t);
	}
	function Rc(e, t) {
		if (!M) switch (e.tailMode) {
			case "hidden":
				t = e.tail;
				for (var n = null; t !== null;) t.alternate !== null && (n = t), t = t.sibling;
				n === null ? e.tail = null : n.sibling = null;
				break;
			case "collapsed":
				n = e.tail;
				for (var r = null; n !== null;) n.alternate !== null && (r = n), n = n.sibling;
				r === null ? t || e.tail === null ? e.tail = null : e.tail.sibling = null : r.sibling = null;
		}
	}
	function zc(e) {
		var t = e.alternate !== null && e.alternate.child === e.child, n = 0, r = 0;
		if (t) for (var i = e.child; i !== null;) n |= i.lanes | i.childLanes, r |= i.subtreeFlags & 65011712, r |= i.flags & 65011712, i.return = e, i = i.sibling;
		else for (i = e.child; i !== null;) n |= i.lanes | i.childLanes, r |= i.subtreeFlags, r |= i.flags, i.return = e, i = i.sibling;
		return e.subtreeFlags |= r, e.childLanes = n, t;
	}
	function Bc(e, t, n) {
		var r = t.pendingProps;
		switch (Ri(t), t.tag) {
			case 16:
			case 15:
			case 0:
			case 11:
			case 7:
			case 8:
			case 12:
			case 9:
			case 14: return zc(t), null;
			case 1: return zc(t), null;
			case 3: return n = t.stateNode, r = null, e !== null && (r = e.memoizedState.cache), t.memoizedState.cache !== r && (t.flags |= 2048), na(ma), be(), n.pendingContext && (n.context = n.pendingContext, n.pendingContext = null), (e === null || e.child === null) && (Ji(t) ? Pc(t) : e === null || e.memoizedState.isDehydrated && !(t.flags & 256) || (t.flags |= 1024, Xi())), zc(t), null;
			case 26:
				var i = t.type, a = t.memoizedState;
				return e === null ? (Pc(t), a === null ? (zc(t), Fc(t, i, null, r, n)) : (zc(t), Ic(t, a))) : a ? a === e.memoizedState ? (zc(t), t.flags &= -16777217) : (Pc(t), zc(t), Ic(t, a)) : (e = e.memoizedProps, e !== r && Pc(t), zc(t), Fc(t, i, e, r, n)), null;
			case 27:
				if (Se(t), n = _e.current, i = t.type, e !== null && t.stateNode != null) e.memoizedProps !== r && Pc(t);
				else {
					if (!r) {
						if (t.stateNode === null) throw Error(s(166));
						return zc(t), null;
					}
					e = he.current, Ji(t) ? Ki(t, e) : (e = ff(i, r, n), t.stateNode = e, Pc(t));
				}
				return zc(t), null;
			case 5:
				if (Se(t), i = t.type, e !== null && t.stateNode != null) e.memoizedProps !== r && Pc(t);
				else {
					if (!r) {
						if (t.stateNode === null) throw Error(s(166));
						return zc(t), null;
					}
					if (a = he.current, Ji(t)) Ki(t, a);
					else {
						var o = Bd(_e.current);
						switch (a) {
							case 1:
								a = o.createElementNS("http://www.w3.org/2000/svg", i);
								break;
							case 2:
								a = o.createElementNS("http://www.w3.org/1998/Math/MathML", i);
								break;
							default: switch (i) {
								case "svg":
									a = o.createElementNS("http://www.w3.org/2000/svg", i);
									break;
								case "math":
									a = o.createElementNS("http://www.w3.org/1998/Math/MathML", i);
									break;
								case "script":
									a = o.createElement("div"), a.innerHTML = "<script><\/script>", a = a.removeChild(a.firstChild);
									break;
								case "select":
									a = typeof r.is == "string" ? o.createElement("select", { is: r.is }) : o.createElement("select"), r.multiple ? a.multiple = !0 : r.size && (a.size = r.size);
									break;
								default: a = typeof r.is == "string" ? o.createElement(i, { is: r.is }) : o.createElement(i);
							}
						}
						a[gt] = t, a[_t] = r;
						a: for (o = t.child; o !== null;) {
							if (o.tag === 5 || o.tag === 6) a.appendChild(o.stateNode);
							else if (o.tag !== 4 && o.tag !== 27 && o.child !== null) {
								o.child.return = o, o = o.child;
								continue;
							}
							if (o === t) break a;
							for (; o.sibling === null;) {
								if (o.return === null || o.return === t) break a;
								o = o.return;
							}
							o.sibling.return = o.return, o = o.sibling;
						}
						t.stateNode = a;
						a: switch ($(a, i, r), i) {
							case "button":
							case "input":
							case "select":
							case "textarea":
								r = !!r.autoFocus;
								break a;
							case "img":
								r = !0;
								break a;
							default: r = !1;
						}
						r && Pc(t);
					}
				}
				return zc(t), Fc(t, t.type, e === null ? null : e.memoizedProps, t.pendingProps, n), null;
			case 6:
				if (e && t.stateNode != null) e.memoizedProps !== r && Pc(t);
				else {
					if (typeof r != "string" && t.stateNode === null) throw Error(s(166));
					if (e = _e.current, Ji(t)) {
						if (e = t.stateNode, n = t.memoizedProps, r = null, i = Bi, i !== null) switch (i.tag) {
							case 27:
							case 5: r = i.memoizedProps;
						}
						e[gt] = t, e = !!(e.nodeValue === n || r !== null && !0 === r.suppressHydrationWarning || Nd(e.nodeValue, n)), e || Gi(t, !0);
					} else e = Bd(e).createTextNode(r), e[gt] = t, t.stateNode = e;
				}
				return zc(t), null;
			case 31:
				if (n = t.memoizedState, e === null || e.memoizedState !== null) {
					if (r = Ji(t), n !== null) {
						if (e === null) {
							if (!r) throw Error(s(318));
							if (e = t.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(s(557));
							e[gt] = t;
						} else Yi(), !(t.flags & 128) && (t.memoizedState = null), t.flags |= 4;
						zc(t), e = !1;
					} else n = Xi(), e !== null && e.memoizedState !== null && (e.memoizedState.hydrationErrors = n), e = !0;
					if (!e) return t.flags & 256 ? (mo(t), t) : (mo(t), null);
					if (t.flags & 128) throw Error(s(558));
				}
				return zc(t), null;
			case 13:
				if (r = t.memoizedState, e === null || e.memoizedState !== null && e.memoizedState.dehydrated !== null) {
					if (i = Ji(t), r !== null && r.dehydrated !== null) {
						if (e === null) {
							if (!i) throw Error(s(318));
							if (i = t.memoizedState, i = i === null ? null : i.dehydrated, !i) throw Error(s(317));
							i[gt] = t;
						} else Yi(), !(t.flags & 128) && (t.memoizedState = null), t.flags |= 4;
						zc(t), i = !1;
					} else i = Xi(), e !== null && e.memoizedState !== null && (e.memoizedState.hydrationErrors = i), i = !0;
					if (!i) return t.flags & 256 ? (mo(t), t) : (mo(t), null);
				}
				return mo(t), t.flags & 128 ? (t.lanes = n, t) : (n = r !== null, e = e !== null && e.memoizedState !== null, n && (r = t.child, i = null, r.alternate !== null && r.alternate.memoizedState !== null && r.alternate.memoizedState.cachePool !== null && (i = r.alternate.memoizedState.cachePool.pool), a = null, r.memoizedState !== null && r.memoizedState.cachePool !== null && (a = r.memoizedState.cachePool.pool), a !== i && (r.flags |= 2048)), n !== e && n && (t.child.flags |= 8192), Lc(t, t.updateQueue), zc(t), null);
			case 4: return be(), e === null && Cd(t.stateNode.containerInfo), zc(t), null;
			case 10: return na(t.type), zc(t), null;
			case 19:
				if (me(I), r = t.memoizedState, r === null) return zc(t), null;
				if (i = !!(t.flags & 128), a = r.rendering, a === null) {
					if (i) Rc(r, !1);
					else {
						if (Gl !== 0 || e !== null && e.flags & 128) for (e = t.child; e !== null;) {
							if (a = ho(e), a !== null) {
								for (t.flags |= 128, Rc(r, !1), e = a.updateQueue, t.updateQueue = e, Lc(t, e), t.subtreeFlags = 0, e = n, n = t.child; n !== null;) vi(n, e), n = n.sibling;
								return O(I, I.current & 1 | 2), M && Fi(t, r.treeForkCount), t.child;
							}
							e = e.sibling;
						}
						r.tail !== null && Fe() > nu && (t.flags |= 128, i = !0, Rc(r, !1), t.lanes = 4194304);
					}
				} else {
					if (!i) {
						if (e = ho(a), e !== null) {
							if (t.flags |= 128, i = !0, e = e.updateQueue, t.updateQueue = e, Lc(t, e), Rc(r, !0), r.tail === null && r.tailMode === "hidden" && !a.alternate && !M) return zc(t), null;
						} else 2 * Fe() - r.renderingStartTime > nu && n !== 536870912 && (t.flags |= 128, i = !0, Rc(r, !1), t.lanes = 4194304);
					}
					r.isBackwards ? (a.sibling = t.child, t.child = a) : (e = r.last, e === null ? t.child = a : e.sibling = a, r.last = a);
				}
				return r.tail === null ? (zc(t), null) : (e = r.tail, r.rendering = e, r.tail = e.sibling, r.renderingStartTime = Fe(), e.sibling = null, n = I.current, O(I, i ? n & 1 | 2 : n & 1), M && Fi(t, r.treeForkCount), e);
			case 22:
			case 23: return mo(t), so(), r = t.memoizedState !== null, e === null ? r && (t.flags |= 8192) : e.memoizedState !== null !== r && (t.flags |= 8192), r ? n & 536870912 && !(t.flags & 128) && (zc(t), t.subtreeFlags & 6 && (t.flags |= 8192)) : zc(t), n = t.updateQueue, n !== null && Lc(t, n.retryQueue), n = null, e !== null && e.memoizedState !== null && e.memoizedState.cachePool !== null && (n = e.memoizedState.cachePool.pool), r = null, t.memoizedState !== null && t.memoizedState.cachePool !== null && (r = t.memoizedState.cachePool.pool), r !== n && (t.flags |= 2048), e !== null && me(Ta), null;
			case 24: return n = null, e !== null && (n = e.memoizedState.cache), t.memoizedState.cache !== n && (t.flags |= 2048), na(ma), zc(t), null;
			case 25: return null;
			case 30: return null;
		}
		throw Error(s(156, t.tag));
	}
	function Vc(e, t) {
		switch (Ri(t), t.tag) {
			case 1: return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 3: return na(ma), be(), e = t.flags, e & 65536 && !(e & 128) ? (t.flags = e & -65537 | 128, t) : null;
			case 26:
			case 27:
			case 5: return Se(t), null;
			case 31:
				if (t.memoizedState !== null) {
					if (mo(t), t.alternate === null) throw Error(s(340));
					Yi();
				}
				return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 13:
				if (mo(t), e = t.memoizedState, e !== null && e.dehydrated !== null) {
					if (t.alternate === null) throw Error(s(340));
					Yi();
				}
				return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 19: return me(I), null;
			case 4: return be(), null;
			case 10: return na(t.type), null;
			case 22:
			case 23: return mo(t), so(), e !== null && me(Ta), e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 24: return na(ma), null;
			case 25: return null;
			default: return null;
		}
	}
	function Hc(e, t) {
		switch (Ri(t), t.tag) {
			case 3:
				na(ma), be();
				break;
			case 26:
			case 27:
			case 5:
				Se(t);
				break;
			case 4:
				be();
				break;
			case 31:
				t.memoizedState !== null && mo(t);
				break;
			case 13:
				mo(t);
				break;
			case 19:
				me(I);
				break;
			case 10:
				na(t.type);
				break;
			case 22:
			case 23:
				mo(t), so(), e !== null && me(Ta);
				break;
			case 24: na(ma);
		}
	}
	function Uc(e, t) {
		try {
			var n = t.updateQueue, r = n === null ? null : n.lastEffect;
			if (r !== null) {
				var i = r.next;
				n = i;
				do {
					if ((n.tag & e) === e) {
						r = void 0;
						var a = n.create, o = n.inst;
						r = a(), o.destroy = r;
					}
					n = n.next;
				} while (n !== i);
			}
		} catch (e) {
			X(t, t.return, e);
		}
	}
	function Wc(e, t, n) {
		try {
			var r = t.updateQueue, i = r === null ? null : r.lastEffect;
			if (i !== null) {
				var a = i.next;
				r = a;
				do {
					if ((r.tag & e) === e) {
						var o = r.inst, s = o.destroy;
						if (s !== void 0) {
							o.destroy = void 0, i = t;
							var c = n, l = s;
							try {
								l();
							} catch (e) {
								X(i, c, e);
							}
						}
					}
					r = r.next;
				} while (r !== a);
			}
		} catch (e) {
			X(t, t.return, e);
		}
	}
	function Gc(e) {
		var t = e.updateQueue;
		if (t !== null) {
			var n = e.stateNode;
			try {
				no(t, n);
			} catch (t) {
				X(e, e.return, t);
			}
		}
	}
	function Kc(e, t, n) {
		n.props = Js(e.type, e.memoizedProps), n.state = e.memoizedState;
		try {
			n.componentWillUnmount();
		} catch (n) {
			X(e, t, n);
		}
	}
	function qc(e, t) {
		try {
			var n = e.ref;
			if (n !== null) {
				switch (e.tag) {
					case 26:
					case 27:
					case 5:
						var r = e.stateNode;
						break;
					case 30:
						r = e.stateNode;
						break;
					default: r = e.stateNode;
				}
				typeof n == "function" ? e.refCleanup = n(r) : n.current = r;
			}
		} catch (n) {
			X(e, t, n);
		}
	}
	function Jc(e, t) {
		var n = e.ref, r = e.refCleanup;
		if (n !== null) {
			if (typeof r == "function") try {
				r();
			} catch (n) {
				X(e, t, n);
			} finally {
				e.refCleanup = null, e = e.alternate, e != null && (e.refCleanup = null);
			}
			else if (typeof n == "function") try {
				n(null);
			} catch (n) {
				X(e, t, n);
			}
			else n.current = null;
		}
	}
	function Yc(e) {
		var t = e.type, n = e.memoizedProps, r = e.stateNode;
		try {
			a: switch (t) {
				case "button":
				case "input":
				case "select":
				case "textarea":
					n.autoFocus && r.focus();
					break a;
				case "img": n.src ? r.src = n.src : n.srcSet && (r.srcset = n.srcSet);
			}
		} catch (t) {
			X(e, e.return, t);
		}
	}
	function Xc(e, t, n) {
		try {
			var r = e.stateNode;
			Fd(r, e.type, n, t), r[_t] = t;
		} catch (t) {
			X(e, e.return, t);
		}
	}
	function Zc(e) {
		return e.tag === 5 || e.tag === 3 || e.tag === 26 || e.tag === 27 && Zd(e.type) || e.tag === 4;
	}
	function Qc(e) {
		a: for (;;) {
			for (; e.sibling === null;) {
				if (e.return === null || Zc(e.return)) return null;
				e = e.return;
			}
			for (e.sibling.return = e.return, e = e.sibling; e.tag !== 5 && e.tag !== 6 && e.tag !== 18;) {
				if (e.tag === 27 && Zd(e.type) || e.flags & 2 || e.child === null || e.tag === 4) continue a;
				e.child.return = e, e = e.child;
			}
			if (!(e.flags & 2)) return e.stateNode;
		}
	}
	function U(e, t, n) {
		var r = e.tag;
		if (r === 5 || r === 6) e = e.stateNode, t ? (n.nodeType === 9 ? n.body : n.nodeName === "HTML" ? n.ownerDocument.body : n).insertBefore(e, t) : (t = n.nodeType === 9 ? n.body : n.nodeName === "HTML" ? n.ownerDocument.body : n, t.appendChild(e), n = n._reactRootContainer, n != null || t.onclick !== null || (t.onclick = un));
		else if (r !== 4 && (r === 27 && Zd(e.type) && (n = e.stateNode, t = null), e = e.child, e !== null)) for (U(e, t, n), e = e.sibling; e !== null;) U(e, t, n), e = e.sibling;
	}
	function $c(e, t, n) {
		var r = e.tag;
		if (r === 5 || r === 6) e = e.stateNode, t ? n.insertBefore(e, t) : n.appendChild(e);
		else if (r !== 4 && (r === 27 && Zd(e.type) && (n = e.stateNode), e = e.child, e !== null)) for ($c(e, t, n), e = e.sibling; e !== null;) $c(e, t, n), e = e.sibling;
	}
	function el(e) {
		var t = e.stateNode, n = e.memoizedProps;
		try {
			for (var r = e.type, i = t.attributes; i.length;) t.removeAttributeNode(i[0]);
			$(t, r, n), t[gt] = e, t[_t] = n;
		} catch (t) {
			X(e, e.return, t);
		}
	}
	var tl = !1, nl = !1, rl = !1, il = typeof WeakSet == "function" ? WeakSet : Set, al = null;
	function ol(e, t) {
		if (e = e.containerInfo, Rd = sp, e = Pr(e), Fr(e)) {
			if ("selectionStart" in e) var n = {
				start: e.selectionStart,
				end: e.selectionEnd
			};
			else a: {
				n = (n = e.ownerDocument) && n.defaultView || window;
				var r = n.getSelection && n.getSelection();
				if (r && r.rangeCount !== 0) {
					n = r.anchorNode;
					var i = r.anchorOffset, a = r.focusNode;
					r = r.focusOffset;
					try {
						n.nodeType, a.nodeType;
					} catch {
						n = null;
						break a;
					}
					var o = 0, c = -1, l = -1, u = 0, d = 0, f = e, p = null;
					b: for (;;) {
						for (var m; f !== n || i !== 0 && f.nodeType !== 3 || (c = o + i), f !== a || r !== 0 && f.nodeType !== 3 || (l = o + r), f.nodeType === 3 && (o += f.nodeValue.length), (m = f.firstChild) !== null;) p = f, f = m;
						for (;;) {
							if (f === e) break b;
							if (p === n && ++u === i && (c = o), p === a && ++d === r && (l = o), (m = f.nextSibling) !== null) break;
							f = p, p = f.parentNode;
						}
						f = m;
					}
					n = c === -1 || l === -1 ? null : {
						start: c,
						end: l
					};
				} else n = null;
			}
			n ||= {
				start: 0,
				end: 0
			};
		} else n = null;
		for (zd = {
			focusedElem: e,
			selectionRange: n
		}, sp = !1, al = t; al !== null;) if (t = al, e = t.child, t.subtreeFlags & 1028 && e !== null) e.return = t, al = e;
		else for (; al !== null;) {
			switch (t = al, a = t.alternate, e = t.flags, t.tag) {
				case 0:
					if (e & 4 && (e = t.updateQueue, e = e === null ? null : e.events, e !== null)) for (n = 0; n < e.length; n++) i = e[n], i.ref.impl = i.nextImpl;
					break;
				case 11:
				case 15: break;
				case 1:
					if (e & 1024 && a !== null) {
						e = void 0, n = t, i = a.memoizedProps, a = a.memoizedState, r = n.stateNode;
						try {
							var h = Js(n.type, i);
							e = r.getSnapshotBeforeUpdate(h, a), r.__reactInternalSnapshotBeforeUpdate = e;
						} catch (e) {
							X(n, n.return, e);
						}
					}
					break;
				case 3:
					if (e & 1024) {
						if (e = t.stateNode.containerInfo, n = e.nodeType, n === 9) ef(e);
						else if (n === 1) switch (e.nodeName) {
							case "HEAD":
							case "HTML":
							case "BODY":
								ef(e);
								break;
							default: e.textContent = "";
						}
					}
					break;
				case 5:
				case 26:
				case 27:
				case 6:
				case 4:
				case 17: break;
				default: if (e & 1024) throw Error(s(163));
			}
			if (e = t.sibling, e !== null) {
				e.return = t.return, al = e;
				break;
			}
			al = t.return;
		}
	}
	function sl(e, t, n) {
		var r = n.flags;
		switch (n.tag) {
			case 0:
			case 11:
			case 15:
				Sl(e, n), r & 4 && Uc(5, n);
				break;
			case 1:
				if (Sl(e, n), r & 4) {
					if (e = n.stateNode, t === null) try {
						e.componentDidMount();
					} catch (e) {
						X(n, n.return, e);
					}
					else {
						var i = Js(n.type, t.memoizedProps);
						t = t.memoizedState;
						try {
							e.componentDidUpdate(i, t, e.__reactInternalSnapshotBeforeUpdate);
						} catch (e) {
							X(n, n.return, e);
						}
					}
				}
				r & 64 && Gc(n), r & 512 && qc(n, n.return);
				break;
			case 3:
				if (Sl(e, n), r & 64 && (e = n.updateQueue, e !== null)) {
					if (t = null, n.child !== null) switch (n.child.tag) {
						case 27:
						case 5:
							t = n.child.stateNode;
							break;
						case 1: t = n.child.stateNode;
					}
					try {
						no(e, t);
					} catch (e) {
						X(n, n.return, e);
					}
				}
				break;
			case 27: t === null && r & 4 && el(n);
			case 26:
			case 5:
				Sl(e, n), t === null && r & 4 && Yc(n), r & 512 && qc(n, n.return);
				break;
			case 12:
				Sl(e, n);
				break;
			case 31:
				Sl(e, n), r & 4 && pl(e, n);
				break;
			case 13:
				Sl(e, n), r & 4 && ml(e, n), r & 64 && (e = n.memoizedState, e !== null && (e = e.dehydrated, e !== null && (n = Yu.bind(null, n), sf(e, n))));
				break;
			case 22:
				if (r = n.memoizedState !== null || tl, !r) {
					t = t !== null && t.memoizedState !== null || nl, i = tl;
					var a = nl;
					tl = r, (nl = t) && !a ? wl(e, n, !!(n.subtreeFlags & 8772)) : Sl(e, n), tl = i, nl = a;
				}
				break;
			case 30: break;
			default: Sl(e, n);
		}
	}
	function cl(e) {
		var t = e.alternate;
		t !== null && (e.alternate = null, cl(t)), e.child = null, e.deletions = null, e.sibling = null, e.tag === 5 && (t = e.stateNode, t !== null && wt(t)), e.stateNode = null, e.return = null, e.dependencies = null, e.memoizedProps = null, e.memoizedState = null, e.pendingProps = null, e.stateNode = null, e.updateQueue = null;
	}
	var ll = null, ul = !1;
	function dl(e, t, n) {
		for (n = n.child; n !== null;) fl(e, t, n), n = n.sibling;
	}
	function fl(e, t, n) {
		if (Ge && typeof Ge.onCommitFiberUnmount == "function") try {
			Ge.onCommitFiberUnmount(We, n);
		} catch {}
		switch (n.tag) {
			case 26:
				nl || Jc(n, t), dl(e, t, n), n.memoizedState ? n.memoizedState.count-- : n.stateNode && (n = n.stateNode, n.parentNode.removeChild(n));
				break;
			case 27:
				nl || Jc(n, t);
				var r = ll, i = ul;
				Zd(n.type) && (ll = n.stateNode, ul = !1), dl(e, t, n), pf(n.stateNode), ll = r, ul = i;
				break;
			case 5: nl || Jc(n, t);
			case 6:
				if (r = ll, i = ul, ll = null, dl(e, t, n), ll = r, ul = i, ll !== null) {
					if (ul) try {
						(ll.nodeType === 9 ? ll.body : ll.nodeName === "HTML" ? ll.ownerDocument.body : ll).removeChild(n.stateNode);
					} catch (e) {
						X(n, t, e);
					}
					else try {
						ll.removeChild(n.stateNode);
					} catch (e) {
						X(n, t, e);
					}
				}
				break;
			case 18:
				ll !== null && (ul ? (e = ll, Qd(e.nodeType === 9 ? e.body : e.nodeName === "HTML" ? e.ownerDocument.body : e, n.stateNode), Np(e)) : Qd(ll, n.stateNode));
				break;
			case 4:
				r = ll, i = ul, ll = n.stateNode.containerInfo, ul = !0, dl(e, t, n), ll = r, ul = i;
				break;
			case 0:
			case 11:
			case 14:
			case 15:
				Wc(2, n, t), nl || Wc(4, n, t), dl(e, t, n);
				break;
			case 1:
				nl || (Jc(n, t), r = n.stateNode, typeof r.componentWillUnmount == "function" && Kc(n, t, r)), dl(e, t, n);
				break;
			case 21:
				dl(e, t, n);
				break;
			case 22:
				nl = (r = nl) || n.memoizedState !== null, dl(e, t, n), nl = r;
				break;
			default: dl(e, t, n);
		}
	}
	function pl(e, t) {
		if (t.memoizedState === null && (e = t.alternate, e !== null && (e = e.memoizedState, e !== null))) {
			e = e.dehydrated;
			try {
				Np(e);
			} catch (e) {
				X(t, t.return, e);
			}
		}
	}
	function ml(e, t) {
		if (t.memoizedState === null && (e = t.alternate, e !== null && (e = e.memoizedState, e !== null && (e = e.dehydrated, e !== null)))) try {
			Np(e);
		} catch (e) {
			X(t, t.return, e);
		}
	}
	function hl(e) {
		switch (e.tag) {
			case 31:
			case 13:
			case 19:
				var t = e.stateNode;
				return t === null && (t = e.stateNode = new il()), t;
			case 22: return e = e.stateNode, t = e._retryCache, t === null && (t = e._retryCache = new il()), t;
			default: throw Error(s(435, e.tag));
		}
	}
	function gl(e, t) {
		var n = hl(e);
		t.forEach(function(t) {
			if (!n.has(t)) {
				n.add(t);
				var r = Xu.bind(null, e, t);
				t.then(r, r);
			}
		});
	}
	function _l(e, t) {
		var n = t.deletions;
		if (n !== null) for (var r = 0; r < n.length; r++) {
			var i = n[r], a = e, o = t, c = o;
			a: for (; c !== null;) {
				switch (c.tag) {
					case 27:
						if (Zd(c.type)) {
							ll = c.stateNode, ul = !1;
							break a;
						}
						break;
					case 5:
						ll = c.stateNode, ul = !1;
						break a;
					case 3:
					case 4:
						ll = c.stateNode.containerInfo, ul = !0;
						break a;
				}
				c = c.return;
			}
			if (ll === null) throw Error(s(160));
			fl(a, o, i), ll = null, ul = !1, a = i.alternate, a !== null && (a.return = null), i.return = null;
		}
		if (t.subtreeFlags & 13886) for (t = t.child; t !== null;) yl(t, e), t = t.sibling;
	}
	var vl = null;
	function yl(e, t) {
		var n = e.alternate, r = e.flags;
		switch (e.tag) {
			case 0:
			case 11:
			case 14:
			case 15:
				_l(t, e), bl(e), r & 4 && (Wc(3, e, e.return), Uc(3, e), Wc(5, e, e.return));
				break;
			case 1:
				_l(t, e), bl(e), r & 512 && (nl || n === null || Jc(n, n.return)), r & 64 && tl && (e = e.updateQueue, e !== null && (r = e.callbacks, r !== null && (n = e.shared.hiddenCallbacks, e.shared.hiddenCallbacks = n === null ? r : n.concat(r))));
				break;
			case 26:
				var i = vl;
				if (_l(t, e), bl(e), r & 512 && (nl || n === null || Jc(n, n.return)), r & 4) {
					var a = n === null ? null : n.memoizedState;
					if (r = e.memoizedState, n === null) {
						if (r === null) {
							if (e.stateNode === null) {
								a: {
									r = e.type, n = e.memoizedProps, i = i.ownerDocument || i;
									b: switch (r) {
										case "title":
											a = i.getElementsByTagName("title")[0], (!a || a[Ct] || a[gt] || a.namespaceURI === "http://www.w3.org/2000/svg" || a.hasAttribute("itemprop")) && (a = i.createElement(r), i.head.insertBefore(a, i.querySelector("head > title"))), $(a, r, n), a[gt] = e, kt(a), r = a;
											break a;
										case "link":
											var o = Vf("link", "href", i).get(r + (n.href || ""));
											if (o) {
												for (var c = 0; c < o.length; c++) if (a = o[c], a.getAttribute("href") === (n.href == null || n.href === "" ? null : n.href) && a.getAttribute("rel") === (n.rel == null ? null : n.rel) && a.getAttribute("title") === (n.title == null ? null : n.title) && a.getAttribute("crossorigin") === (n.crossOrigin == null ? null : n.crossOrigin)) {
													o.splice(c, 1);
													break b;
												}
											}
											a = i.createElement(r), $(a, r, n), i.head.appendChild(a);
											break;
										case "meta":
											if (o = Vf("meta", "content", i).get(r + (n.content || ""))) {
												for (c = 0; c < o.length; c++) if (a = o[c], a.getAttribute("content") === (n.content == null ? null : "" + n.content) && a.getAttribute("name") === (n.name == null ? null : n.name) && a.getAttribute("property") === (n.property == null ? null : n.property) && a.getAttribute("http-equiv") === (n.httpEquiv == null ? null : n.httpEquiv) && a.getAttribute("charset") === (n.charSet == null ? null : n.charSet)) {
													o.splice(c, 1);
													break b;
												}
											}
											a = i.createElement(r), $(a, r, n), i.head.appendChild(a);
											break;
										default: throw Error(s(468, r));
									}
									a[gt] = e, kt(a), r = a;
								}
								e.stateNode = r;
							} else Hf(i, e.type, e.stateNode);
						} else e.stateNode = If(i, r, e.memoizedProps);
					} else a === r ? r === null && e.stateNode !== null && Xc(e, e.memoizedProps, n.memoizedProps) : (a === null ? n.stateNode !== null && (n = n.stateNode, n.parentNode.removeChild(n)) : a.count--, r === null ? Hf(i, e.type, e.stateNode) : If(i, r, e.memoizedProps));
				}
				break;
			case 27:
				_l(t, e), bl(e), r & 512 && (nl || n === null || Jc(n, n.return)), n !== null && r & 4 && Xc(e, e.memoizedProps, n.memoizedProps);
				break;
			case 5:
				if (_l(t, e), bl(e), r & 512 && (nl || n === null || Jc(n, n.return)), e.flags & 32) {
					i = e.stateNode;
					try {
						tn(i, "");
					} catch (t) {
						X(e, e.return, t);
					}
				}
				r & 4 && e.stateNode != null && (i = e.memoizedProps, Xc(e, i, n === null ? i : n.memoizedProps)), r & 1024 && (rl = !0);
				break;
			case 6:
				if (_l(t, e), bl(e), r & 4) {
					if (e.stateNode === null) throw Error(s(162));
					r = e.memoizedProps, n = e.stateNode;
					try {
						n.nodeValue = r;
					} catch (t) {
						X(e, e.return, t);
					}
				}
				break;
			case 3:
				if (Bf = null, i = vl, vl = gf(t.containerInfo), _l(t, e), vl = i, bl(e), r & 4 && n !== null && n.memoizedState.isDehydrated) try {
					Np(t.containerInfo);
				} catch (t) {
					X(e, e.return, t);
				}
				rl && (rl = !1, xl(e));
				break;
			case 4:
				r = vl, vl = gf(e.stateNode.containerInfo), _l(t, e), bl(e), vl = r;
				break;
			case 12:
				_l(t, e), bl(e);
				break;
			case 31:
				_l(t, e), bl(e), r & 4 && (r = e.updateQueue, r !== null && (e.updateQueue = null, gl(e, r)));
				break;
			case 13:
				_l(t, e), bl(e), e.child.flags & 8192 && e.memoizedState !== null != (n !== null && n.memoizedState !== null) && (eu = Fe()), r & 4 && (r = e.updateQueue, r !== null && (e.updateQueue = null, gl(e, r)));
				break;
			case 22:
				i = e.memoizedState !== null;
				var l = n !== null && n.memoizedState !== null, u = tl, d = nl;
				if (tl = u || i, nl = d || l, _l(t, e), nl = d, tl = u, bl(e), r & 8192) a: for (t = e.stateNode, t._visibility = i ? t._visibility & -2 : t._visibility | 1, i && (n === null || l || tl || nl || Cl(e)), n = null, t = e;;) {
					if (t.tag === 5 || t.tag === 26) {
						if (n === null) {
							l = n = t;
							try {
								if (a = l.stateNode, i) o = a.style, typeof o.setProperty == "function" ? o.setProperty("display", "none", "important") : o.display = "none";
								else {
									c = l.stateNode;
									var f = l.memoizedProps.style, p = f != null && f.hasOwnProperty("display") ? f.display : null;
									c.style.display = p == null || typeof p == "boolean" ? "" : ("" + p).trim();
								}
							} catch (e) {
								X(l, l.return, e);
							}
						}
					} else if (t.tag === 6) {
						if (n === null) {
							l = t;
							try {
								l.stateNode.nodeValue = i ? "" : l.memoizedProps;
							} catch (e) {
								X(l, l.return, e);
							}
						}
					} else if (t.tag === 18) {
						if (n === null) {
							l = t;
							try {
								var m = l.stateNode;
								i ? $d(m, !0) : $d(l.stateNode, !1);
							} catch (e) {
								X(l, l.return, e);
							}
						}
					} else if ((t.tag !== 22 && t.tag !== 23 || t.memoizedState === null || t === e) && t.child !== null) {
						t.child.return = t, t = t.child;
						continue;
					}
					if (t === e) break a;
					for (; t.sibling === null;) {
						if (t.return === null || t.return === e) break a;
						n === t && (n = null), t = t.return;
					}
					n === t && (n = null), t.sibling.return = t.return, t = t.sibling;
				}
				r & 4 && (r = e.updateQueue, r !== null && (n = r.retryQueue, n !== null && (r.retryQueue = null, gl(e, n))));
				break;
			case 19:
				_l(t, e), bl(e), r & 4 && (r = e.updateQueue, r !== null && (e.updateQueue = null, gl(e, r)));
				break;
			case 30: break;
			case 21: break;
			default: _l(t, e), bl(e);
		}
	}
	function bl(e) {
		var t = e.flags;
		if (t & 2) {
			try {
				for (var n, r = e.return; r !== null;) {
					if (Zc(r)) {
						n = r;
						break;
					}
					r = r.return;
				}
				if (n == null) throw Error(s(160));
				switch (n.tag) {
					case 27:
						var i = n.stateNode;
						$c(e, Qc(e), i);
						break;
					case 5:
						var a = n.stateNode;
						n.flags & 32 && (tn(a, ""), n.flags &= -33), $c(e, Qc(e), a);
						break;
					case 3:
					case 4:
						var o = n.stateNode.containerInfo;
						U(e, Qc(e), o);
						break;
					default: throw Error(s(161));
				}
			} catch (t) {
				X(e, e.return, t);
			}
			e.flags &= -3;
		}
		t & 4096 && (e.flags &= -4097);
	}
	function xl(e) {
		if (e.subtreeFlags & 1024) for (e = e.child; e !== null;) {
			var t = e;
			xl(t), t.tag === 5 && t.flags & 1024 && t.stateNode.reset(), e = e.sibling;
		}
	}
	function Sl(e, t) {
		if (t.subtreeFlags & 8772) for (t = t.child; t !== null;) sl(e, t.alternate, t), t = t.sibling;
	}
	function Cl(e) {
		for (e = e.child; e !== null;) {
			var t = e;
			switch (t.tag) {
				case 0:
				case 11:
				case 14:
				case 15:
					Wc(4, t, t.return), Cl(t);
					break;
				case 1:
					Jc(t, t.return);
					var n = t.stateNode;
					typeof n.componentWillUnmount == "function" && Kc(t, t.return, n), Cl(t);
					break;
				case 27: pf(t.stateNode);
				case 26:
				case 5:
					Jc(t, t.return), Cl(t);
					break;
				case 22:
					t.memoizedState === null && Cl(t);
					break;
				case 30:
					Cl(t);
					break;
				default: Cl(t);
			}
			e = e.sibling;
		}
	}
	function wl(e, t, n) {
		for (n &&= !!(t.subtreeFlags & 8772), t = t.child; t !== null;) {
			var r = t.alternate, i = e, a = t, o = a.flags;
			switch (a.tag) {
				case 0:
				case 11:
				case 15:
					wl(i, a, n), Uc(4, a);
					break;
				case 1:
					if (wl(i, a, n), r = a, i = r.stateNode, typeof i.componentDidMount == "function") try {
						i.componentDidMount();
					} catch (e) {
						X(r, r.return, e);
					}
					if (r = a, i = r.updateQueue, i !== null) {
						var s = r.stateNode;
						try {
							var c = i.shared.hiddenCallbacks;
							if (c !== null) for (i.shared.hiddenCallbacks = null, i = 0; i < c.length; i++) to(c[i], s);
						} catch (e) {
							X(r, r.return, e);
						}
					}
					n && o & 64 && Gc(a), qc(a, a.return);
					break;
				case 27: el(a);
				case 26:
				case 5:
					wl(i, a, n), n && r === null && o & 4 && Yc(a), qc(a, a.return);
					break;
				case 12:
					wl(i, a, n);
					break;
				case 31:
					wl(i, a, n), n && o & 4 && pl(i, a);
					break;
				case 13:
					wl(i, a, n), n && o & 4 && ml(i, a);
					break;
				case 22:
					a.memoizedState === null && wl(i, a, n), qc(a, a.return);
					break;
				case 30: break;
				default: wl(i, a, n);
			}
			t = t.sibling;
		}
	}
	function Tl(e, t) {
		var n = null;
		e !== null && e.memoizedState !== null && e.memoizedState.cachePool !== null && (n = e.memoizedState.cachePool.pool), e = null, t.memoizedState !== null && t.memoizedState.cachePool !== null && (e = t.memoizedState.cachePool.pool), e !== n && (e != null && e.refCount++, n != null && ga(n));
	}
	function El(e, t) {
		e = null, t.alternate !== null && (e = t.alternate.memoizedState.cache), t = t.memoizedState.cache, t !== e && (t.refCount++, e != null && ga(e));
	}
	function Dl(e, t, n, r) {
		if (t.subtreeFlags & 10256) for (t = t.child; t !== null;) Ol(e, t, n, r), t = t.sibling;
	}
	function Ol(e, t, n, r) {
		var i = t.flags;
		switch (t.tag) {
			case 0:
			case 11:
			case 15:
				Dl(e, t, n, r), i & 2048 && Uc(9, t);
				break;
			case 1:
				Dl(e, t, n, r);
				break;
			case 3:
				Dl(e, t, n, r), i & 2048 && (e = null, t.alternate !== null && (e = t.alternate.memoizedState.cache), t = t.memoizedState.cache, t !== e && (t.refCount++, e != null && ga(e)));
				break;
			case 12:
				if (i & 2048) {
					Dl(e, t, n, r), e = t.stateNode;
					try {
						var a = t.memoizedProps, o = a.id, s = a.onPostCommit;
						typeof s == "function" && s(o, t.alternate === null ? "mount" : "update", e.passiveEffectDuration, -0);
					} catch (e) {
						X(t, t.return, e);
					}
				} else Dl(e, t, n, r);
				break;
			case 31:
				Dl(e, t, n, r);
				break;
			case 13:
				Dl(e, t, n, r);
				break;
			case 23: break;
			case 22:
				a = t.stateNode, o = t.alternate, t.memoizedState === null ? a._visibility & 2 ? Dl(e, t, n, r) : (a._visibility |= 2, kl(e, t, n, r, !!(t.subtreeFlags & 10256) || !1)) : a._visibility & 2 ? Dl(e, t, n, r) : Al(e, t), i & 2048 && Tl(o, t);
				break;
			case 24:
				Dl(e, t, n, r), i & 2048 && El(t.alternate, t);
				break;
			default: Dl(e, t, n, r);
		}
	}
	function kl(e, t, n, r, i) {
		for (i &&= !!(t.subtreeFlags & 10256) || !1, t = t.child; t !== null;) {
			var a = e, o = t, s = n, c = r, l = o.flags;
			switch (o.tag) {
				case 0:
				case 11:
				case 15:
					kl(a, o, s, c, i), Uc(8, o);
					break;
				case 23: break;
				case 22:
					var u = o.stateNode;
					o.memoizedState === null ? (u._visibility |= 2, kl(a, o, s, c, i)) : u._visibility & 2 ? kl(a, o, s, c, i) : Al(a, o), i && l & 2048 && Tl(o.alternate, o);
					break;
				case 24:
					kl(a, o, s, c, i), i && l & 2048 && El(o.alternate, o);
					break;
				default: kl(a, o, s, c, i);
			}
			t = t.sibling;
		}
	}
	function Al(e, t) {
		if (t.subtreeFlags & 10256) for (t = t.child; t !== null;) {
			var n = e, r = t, i = r.flags;
			switch (r.tag) {
				case 22:
					Al(n, r), i & 2048 && Tl(r.alternate, r);
					break;
				case 24:
					Al(n, r), i & 2048 && El(r.alternate, r);
					break;
				default: Al(n, r);
			}
			t = t.sibling;
		}
	}
	var jl = 8192;
	function Ml(e, t, n) {
		if (e.subtreeFlags & jl) for (e = e.child; e !== null;) Nl(e, t, n), e = e.sibling;
	}
	function Nl(e, t, n) {
		switch (e.tag) {
			case 26:
				Ml(e, t, n), e.flags & jl && e.memoizedState !== null && Gf(n, vl, e.memoizedState, e.memoizedProps);
				break;
			case 5:
				Ml(e, t, n);
				break;
			case 3:
			case 4:
				var r = vl;
				vl = gf(e.stateNode.containerInfo), Ml(e, t, n), vl = r;
				break;
			case 22:
				e.memoizedState === null && (r = e.alternate, r !== null && r.memoizedState !== null ? (r = jl, jl = 16777216, Ml(e, t, n), jl = r) : Ml(e, t, n));
				break;
			default: Ml(e, t, n);
		}
	}
	function Pl(e) {
		var t = e.alternate;
		if (t !== null && (e = t.child, e !== null)) {
			t.child = null;
			do
				t = e.sibling, e.sibling = null, e = t;
			while (e !== null);
		}
	}
	function Fl(e) {
		var t = e.deletions;
		if (e.flags & 16) {
			if (t !== null) for (var n = 0; n < t.length; n++) {
				var r = t[n];
				al = r, Ll(r, e);
			}
			Pl(e);
		}
		if (e.subtreeFlags & 10256) for (e = e.child; e !== null;) W(e), e = e.sibling;
	}
	function W(e) {
		switch (e.tag) {
			case 0:
			case 11:
			case 15:
				Fl(e), e.flags & 2048 && Wc(9, e, e.return);
				break;
			case 3:
				Fl(e);
				break;
			case 12:
				Fl(e);
				break;
			case 22:
				var t = e.stateNode;
				e.memoizedState !== null && t._visibility & 2 && (e.return === null || e.return.tag !== 13) ? (t._visibility &= -3, Il(e)) : Fl(e);
				break;
			default: Fl(e);
		}
	}
	function Il(e) {
		var t = e.deletions;
		if (e.flags & 16) {
			if (t !== null) for (var n = 0; n < t.length; n++) {
				var r = t[n];
				al = r, Ll(r, e);
			}
			Pl(e);
		}
		for (e = e.child; e !== null;) {
			switch (t = e, t.tag) {
				case 0:
				case 11:
				case 15:
					Wc(8, t, t.return), Il(t);
					break;
				case 22:
					n = t.stateNode, n._visibility & 2 && (n._visibility &= -3, Il(t));
					break;
				default: Il(t);
			}
			e = e.sibling;
		}
	}
	function Ll(e, t) {
		for (; al !== null;) {
			var n = al;
			switch (n.tag) {
				case 0:
				case 11:
				case 15:
					Wc(8, n, t);
					break;
				case 23:
				case 22:
					if (n.memoizedState !== null && n.memoizedState.cachePool !== null) {
						var r = n.memoizedState.cachePool.pool;
						r != null && r.refCount++;
					}
					break;
				case 24: ga(n.memoizedState.cache);
			}
			if (r = n.child, r !== null) r.return = n, al = r;
			else a: for (n = e; al !== null;) {
				r = al;
				var i = r.sibling, a = r.return;
				if (cl(r), r === n) {
					al = null;
					break a;
				}
				if (i !== null) {
					i.return = a, al = i;
					break a;
				}
				al = a;
			}
		}
	}
	var Rl = {
		getCacheForType: function(e) {
			var t = ca(ma), n = t.data.get(e);
			return n === void 0 && (n = e(), t.data.set(e, n)), n;
		},
		cacheSignal: function() {
			return ca(ma).controller.signal;
		}
	}, zl = typeof WeakMap == "function" ? WeakMap : Map, G = 0, K = null, q = null, J = 0, Y = 0, Bl = null, Vl = !1, Hl = !1, Ul = !1, Wl = 0, Gl = 0, Kl = 0, ql = 0, Jl = 0, Yl = 0, Xl = 0, Zl = null, Ql = null, $l = !1, eu = 0, tu = 0, nu = Infinity, ru = null, iu = null, au = 0, ou = null, su = null, cu = 0, lu = 0, uu = null, du = null, fu = 0, pu = null;
	function mu() {
		return G & 2 && J !== 0 ? J & -J : E.T === null ? pt() : fd();
	}
	function hu() {
		if (Yl === 0) {
			if (!(J & 536870912) || M) {
				var e = Qe;
				Qe <<= 1, !(Qe & 3932160) && (Qe = 262144), Yl = e;
			} else Yl = 536870912;
		}
		return e = co.current, e !== null && (e.flags |= 32), Yl;
	}
	function gu(e, t, n) {
		(e === K && (Y === 2 || Y === 9) || e.cancelPendingCommit !== null) && (Cu(e, 0), bu(e, J, Yl, !1)), ot(e, n), (!(G & 2) || e !== K) && (e === K && (!(G & 2) && (ql |= n), Gl === 4 && bu(e, J, Yl, !1)), id(e));
	}
	function _u(e, t, n) {
		if (G & 6) throw Error(s(327));
		var r = !n && !(t & 127) && (t & e.expiredLanes) === 0 || nt(e, t), i = r ? ju(e, t) : ku(e, t, !0), a = r;
		do {
			if (i === 0) {
				Hl && !r && bu(e, t, 0, !1);
				break;
			}
			if (n = e.current.alternate, a && !yu(n)) {
				i = ku(e, t, !1), a = !1;
				continue;
			}
			if (i === 2) {
				if (a = t, e.errorRecoveryDisabledLanes & a) var o = 0;
				else o = e.pendingLanes & -536870913, o = o === 0 ? o & 536870912 ? 536870912 : 0 : o;
				if (o !== 0) {
					t = o;
					a: {
						var c = e;
						i = Zl;
						var l = c.current.memoizedState.isDehydrated;
						if (l && (Cu(c, o).flags |= 256), o = ku(c, o, !1), o !== 2) {
							if (Ul && !l) {
								c.errorRecoveryDisabledLanes |= a, ql |= a, i = 4;
								break a;
							}
							a = Ql, Ql = i, a !== null && (Ql === null ? Ql = a : Ql.push.apply(Ql, a));
						}
						i = o;
					}
					if (a = !1, i !== 2) continue;
				}
			}
			if (i === 1) {
				Cu(e, 0), bu(e, t, 0, !0);
				break;
			}
			a: {
				switch (r = e, a = i, a) {
					case 0:
					case 1: throw Error(s(345));
					case 4: if ((t & 4194048) !== t) break;
					case 6:
						bu(r, t, Yl, !Vl);
						break a;
					case 2:
						Ql = null;
						break;
					case 3:
					case 5: break;
					default: throw Error(s(329));
				}
				if ((t & 62914560) === t && (i = eu + 300 - Fe(), 10 < i)) {
					if (bu(r, t, Yl, !Vl), tt(r, 0, !0) !== 0) break a;
					cu = t, r.timeoutHandle = Kd(vu.bind(null, r, n, Ql, ru, $l, t, Yl, ql, Xl, Vl, a, "Throttled", -0, 0), i);
					break a;
				}
				vu(r, n, Ql, ru, $l, t, Yl, ql, Xl, Vl, a, null, -0, 0);
			}
			break;
		} while (1);
		id(e);
	}
	function vu(e, t, n, r, i, a, o, s, c, l, u, d, f, p) {
		if (e.timeoutHandle = -1, d = t.subtreeFlags, d & 8192 || (d & 16785408) == 16785408) {
			d = {
				stylesheets: null,
				count: 0,
				imgCount: 0,
				imgBytes: 0,
				suspenseyImages: [],
				waitingForImages: !0,
				waitingForViewTransition: !1,
				unsuspend: un
			}, Nl(t, a, d);
			var m = (a & 62914560) === a ? eu - Fe() : (a & 4194048) === a ? tu - Fe() : 0;
			if (m = qf(d, m), m !== null) {
				cu = a, e.cancelPendingCommit = m(Ru.bind(null, e, t, a, n, r, i, o, s, c, u, d, null, f, p)), bu(e, a, o, !l);
				return;
			}
		}
		Ru(e, t, a, n, r, i, o, s, c);
	}
	function yu(e) {
		for (var t = e;;) {
			var n = t.tag;
			if ((n === 0 || n === 11 || n === 15) && t.flags & 16384 && (n = t.updateQueue, n !== null && (n = n.stores, n !== null))) for (var r = 0; r < n.length; r++) {
				var i = n[r], a = i.getSnapshot;
				i = i.value;
				try {
					if (!kr(a(), i)) return !1;
				} catch {
					return !1;
				}
			}
			if (n = t.child, t.subtreeFlags & 16384 && n !== null) n.return = t, t = n;
			else {
				if (t === e) break;
				for (; t.sibling === null;) {
					if (t.return === null || t.return === e) return !0;
					t = t.return;
				}
				t.sibling.return = t.return, t = t.sibling;
			}
		}
		return !0;
	}
	function bu(e, t, n, r) {
		t &= ~Jl, t &= ~ql, e.suspendedLanes |= t, e.pingedLanes &= ~t, r && (e.warmLanes |= t), r = e.expirationTimes;
		for (var i = t; 0 < i;) {
			var a = 31 - qe(i), o = 1 << a;
			r[a] = -1, i &= ~o;
		}
		n !== 0 && ct(e, n, t);
	}
	function xu() {
		return G & 6 ? !0 : (ad(0, !1), !1);
	}
	function Su() {
		if (q !== null) {
			if (Y === 0) var e = q.return;
			else e = q, ea = $i = null, No(e), Ra = null, za = 0, e = q;
			for (; e !== null;) Hc(e.alternate, e), e = e.return;
			q = null;
		}
	}
	function Cu(e, t) {
		var n = e.timeoutHandle;
		n !== -1 && (e.timeoutHandle = -1, qd(n)), n = e.cancelPendingCommit, n !== null && (e.cancelPendingCommit = null, n()), cu = 0, Su(), K = e, q = n = _i(e.current, null), J = t, Y = 0, Bl = null, Vl = !1, Hl = nt(e, t), Ul = !1, Xl = Yl = Jl = ql = Kl = Gl = 0, Ql = Zl = null, $l = !1, t & 8 && (t |= t & 32);
		var r = e.entangledLanes;
		if (r !== 0) for (e = e.entanglements, r &= t; 0 < r;) {
			var i = 31 - qe(r), a = 1 << i;
			t |= e[i], r &= ~a;
		}
		return Wl = t, si(), n;
	}
	function wu(e, t) {
		L = null, E.H = Bs, t === Oa || t === Aa ? (t = Ia(), Y = 3) : t === ka ? (t = Ia(), Y = 4) : Y = t === ic ? 8 : typeof t == "object" && t && typeof t.then == "function" ? 6 : 1, Bl = t, q === null && (Gl = 1, Qs(e, Ti(t, e.current)));
	}
	function Tu() {
		var e = co.current;
		return e === null ? !0 : (J & 4194048) === J ? lo === null : (J & 62914560) === J || J & 536870912 ? e === lo : !1;
	}
	function Eu() {
		var e = E.H;
		return E.H = Bs, e === null ? Bs : e;
	}
	function Du() {
		var e = E.A;
		return E.A = Rl, e;
	}
	function Ou() {
		Gl = 4, Vl || (J & 4194048) !== J && co.current !== null || (Hl = !0), !(Kl & 134217727) && !(ql & 134217727) || K === null || bu(K, J, Yl, !1);
	}
	function ku(e, t, n) {
		var r = G;
		G |= 2;
		var i = Eu(), a = Du();
		(K !== e || J !== t) && (ru = null, Cu(e, t)), t = !1;
		var o = Gl;
		a: do
			try {
				if (Y !== 0 && q !== null) {
					var s = q, c = Bl;
					switch (Y) {
						case 8:
							Su(), o = 6;
							break a;
						case 3:
						case 2:
						case 9:
						case 6:
							co.current === null && (t = !0);
							var l = Y;
							if (Y = 0, Bl = null, Fu(e, s, c, l), n && Hl) {
								o = 0;
								break a;
							}
							break;
						default: l = Y, Y = 0, Bl = null, Fu(e, s, c, l);
					}
				}
				Au(), o = Gl;
				break;
			} catch (t) {
				wu(e, t);
			}
		while (1);
		return t && e.shellSuspendCounter++, ea = $i = null, G = r, E.H = i, E.A = a, q === null && (K = null, J = 0, si()), o;
	}
	function Au() {
		for (; q !== null;) Nu(q);
	}
	function ju(e, t) {
		var n = G;
		G |= 2;
		var r = Eu(), i = Du();
		K !== e || J !== t ? (ru = null, nu = Fe() + 500, Cu(e, t)) : Hl = nt(e, t);
		a: do
			try {
				if (Y !== 0 && q !== null) {
					t = q;
					var a = Bl;
					b: switch (Y) {
						case 1:
							Y = 0, Bl = null, Fu(e, t, a, 1);
							break;
						case 2:
						case 9:
							if (Ma(a)) {
								Y = 0, Bl = null, Pu(t);
								break;
							}
							t = function() {
								Y !== 2 && Y !== 9 || K !== e || (Y = 7), id(e);
							}, a.then(t, t);
							break a;
						case 3:
							Y = 7;
							break a;
						case 4:
							Y = 5;
							break a;
						case 7:
							Ma(a) ? (Y = 0, Bl = null, Pu(t)) : (Y = 0, Bl = null, Fu(e, t, a, 7));
							break;
						case 5:
							var o = null;
							switch (q.tag) {
								case 26: o = q.memoizedState;
								case 5:
								case 27:
									var c = q;
									if (o ? Wf(o) : c.stateNode.complete) {
										Y = 0, Bl = null;
										var l = c.sibling;
										if (l !== null) q = l;
										else {
											var u = c.return;
											u === null ? q = null : (q = u, Iu(u));
										}
										break b;
									}
							}
							Y = 0, Bl = null, Fu(e, t, a, 5);
							break;
						case 6:
							Y = 0, Bl = null, Fu(e, t, a, 6);
							break;
						case 8:
							Su(), Gl = 6;
							break a;
						default: throw Error(s(462));
					}
				}
				Mu();
				break;
			} catch (t) {
				wu(e, t);
			}
		while (1);
		return ea = $i = null, E.H = r, E.A = i, G = n, q === null ? (K = null, J = 0, si(), Gl) : 0;
	}
	function Mu() {
		for (; q !== null && !Ne();) Nu(q);
	}
	function Nu(e) {
		var t = Nc(e.alternate, e, Wl);
		e.memoizedProps = e.pendingProps, t === null ? Iu(e) : q = t;
	}
	function Pu(e) {
		var t = e, n = t.alternate;
		switch (t.tag) {
			case 15:
			case 0:
				t = vc(n, t, t.pendingProps, t.type, void 0, J);
				break;
			case 11:
				t = vc(n, t, t.pendingProps, t.type.render, t.ref, J);
				break;
			case 5: No(t);
			default: Hc(n, t), t = q = vi(t, Wl), t = Nc(n, t, Wl);
		}
		e.memoizedProps = e.pendingProps, t === null ? Iu(e) : q = t;
	}
	function Fu(e, t, n, r) {
		ea = $i = null, No(t), Ra = null, za = 0;
		var i = t.return;
		try {
			if (rc(e, i, t, n, J)) {
				Gl = 1, Qs(e, Ti(n, e.current)), q = null;
				return;
			}
		} catch (t) {
			if (i !== null) throw q = i, t;
			Gl = 1, Qs(e, Ti(n, e.current)), q = null;
			return;
		}
		t.flags & 32768 ? (M || r === 1 ? e = !0 : Hl || J & 536870912 ? e = !1 : (Vl = e = !0, (r === 2 || r === 9 || r === 3 || r === 6) && (r = co.current, r !== null && r.tag === 13 && (r.flags |= 16384))), Lu(t, e)) : Iu(t);
	}
	function Iu(e) {
		var t = e;
		do {
			if (t.flags & 32768) {
				Lu(t, Vl);
				return;
			}
			e = t.return;
			var n = Bc(t.alternate, t, Wl);
			if (n !== null) {
				q = n;
				return;
			}
			if (t = t.sibling, t !== null) {
				q = t;
				return;
			}
			q = t = e;
		} while (t !== null);
		Gl === 0 && (Gl = 5);
	}
	function Lu(e, t) {
		do {
			var n = Vc(e.alternate, e);
			if (n !== null) {
				n.flags &= 32767, q = n;
				return;
			}
			if (n = e.return, n !== null && (n.flags |= 32768, n.subtreeFlags = 0, n.deletions = null), !t && (e = e.sibling, e !== null)) {
				q = e;
				return;
			}
			q = e = n;
		} while (e !== null);
		Gl = 6, q = null;
	}
	function Ru(e, t, n, r, i, a, o, c, l) {
		e.cancelPendingCommit = null;
		do
			Uu();
		while (au !== 0);
		if (G & 6) throw Error(s(327));
		if (t !== null) {
			if (t === e.current) throw Error(s(177));
			if (a = t.lanes | t.childLanes, a |= oi, st(e, n, a, o, c, l), e === K && (q = K = null, J = 0), su = t, ou = e, cu = n, lu = a, uu = i, du = r, t.subtreeFlags & 10256 || t.flags & 10256 ? (e.callbackNode = null, e.callbackPriority = 0, Zu(ze, function() {
				return Wu(), null;
			})) : (e.callbackNode = null, e.callbackPriority = 0), r = !!(t.flags & 13878), t.subtreeFlags & 13878 || r) {
				r = E.T, E.T = null, i = D.p, D.p = 2, o = G, G |= 4;
				try {
					ol(e, t, n);
				} finally {
					G = o, D.p = i, E.T = r;
				}
			}
			au = 1, zu(), Bu(), Vu();
		}
	}
	function zu() {
		if (au === 1) {
			au = 0;
			var e = ou, t = su, n = !!(t.flags & 13878);
			if (t.subtreeFlags & 13878 || n) {
				n = E.T, E.T = null;
				var r = D.p;
				D.p = 2;
				var i = G;
				G |= 4;
				try {
					yl(t, e);
					var a = zd, o = Pr(e.containerInfo), s = a.focusedElem, c = a.selectionRange;
					if (o !== s && s && s.ownerDocument && Nr(s.ownerDocument.documentElement, s)) {
						if (c !== null && Fr(s)) {
							var l = c.start, u = c.end;
							if (u === void 0 && (u = l), "selectionStart" in s) s.selectionStart = l, s.selectionEnd = Math.min(u, s.value.length);
							else {
								var d = s.ownerDocument || document, f = d && d.defaultView || window;
								if (f.getSelection) {
									var p = f.getSelection(), m = s.textContent.length, h = Math.min(c.start, m), g = c.end === void 0 ? h : Math.min(c.end, m);
									!p.extend && h > g && (o = g, g = h, h = o);
									var _ = Mr(s, h), v = Mr(s, g);
									if (_ && v && (p.rangeCount !== 1 || p.anchorNode !== _.node || p.anchorOffset !== _.offset || p.focusNode !== v.node || p.focusOffset !== v.offset)) {
										var y = d.createRange();
										y.setStart(_.node, _.offset), p.removeAllRanges(), h > g ? (p.addRange(y), p.extend(v.node, v.offset)) : (y.setEnd(v.node, v.offset), p.addRange(y));
									}
								}
							}
						}
						for (d = [], p = s; p = p.parentNode;) p.nodeType === 1 && d.push({
							element: p,
							left: p.scrollLeft,
							top: p.scrollTop
						});
						for (typeof s.focus == "function" && s.focus(), s = 0; s < d.length; s++) {
							var b = d[s];
							b.element.scrollLeft = b.left, b.element.scrollTop = b.top;
						}
					}
					sp = !!Rd, zd = Rd = null;
				} finally {
					G = i, D.p = r, E.T = n;
				}
			}
			e.current = t, au = 2;
		}
	}
	function Bu() {
		if (au === 2) {
			au = 0;
			var e = ou, t = su, n = !!(t.flags & 8772);
			if (t.subtreeFlags & 8772 || n) {
				n = E.T, E.T = null;
				var r = D.p;
				D.p = 2;
				var i = G;
				G |= 4;
				try {
					sl(e, t.alternate, t);
				} finally {
					G = i, D.p = r, E.T = n;
				}
			}
			au = 3;
		}
	}
	function Vu() {
		if (au === 4 || au === 3) {
			au = 0, Pe();
			var e = ou, t = su, n = cu, r = du;
			t.subtreeFlags & 10256 || t.flags & 10256 ? au = 5 : (au = 0, su = ou = null, Hu(e, e.pendingLanes));
			var i = e.pendingLanes;
			if (i === 0 && (iu = null), ft(n), t = t.stateNode, Ge && typeof Ge.onCommitFiberRoot == "function") try {
				Ge.onCommitFiberRoot(We, t, void 0, (t.current.flags & 128) == 128);
			} catch {}
			if (r !== null) {
				t = E.T, i = D.p, D.p = 2, E.T = null;
				try {
					for (var a = e.onRecoverableError, o = 0; o < r.length; o++) {
						var s = r[o];
						a(s.value, { componentStack: s.stack });
					}
				} finally {
					E.T = t, D.p = i;
				}
			}
			cu & 3 && Uu(), id(e), i = e.pendingLanes, n & 261930 && i & 42 ? e === pu ? fu++ : (fu = 0, pu = e) : fu = 0, ad(0, !1);
		}
	}
	function Hu(e, t) {
		(e.pooledCacheLanes &= t) === 0 && (t = e.pooledCache, t != null && (e.pooledCache = null, ga(t)));
	}
	function Uu() {
		return zu(), Bu(), Vu(), Wu();
	}
	function Wu() {
		if (au !== 5) return !1;
		var e = ou, t = lu;
		lu = 0;
		var n = ft(cu), r = E.T, i = D.p;
		try {
			D.p = 32 > n ? 32 : n, E.T = null, n = uu, uu = null;
			var a = ou, o = cu;
			if (au = 0, su = ou = null, cu = 0, G & 6) throw Error(s(331));
			var c = G;
			if (G |= 4, W(a.current), Ol(a, a.current, o, n), G = c, ad(0, !1), Ge && typeof Ge.onPostCommitFiberRoot == "function") try {
				Ge.onPostCommitFiberRoot(We, a);
			} catch {}
			return !0;
		} finally {
			D.p = i, E.T = r, Hu(e, t);
		}
	}
	function Gu(e, t, n) {
		t = Ti(n, t), t = ec(e.stateNode, t, 2), e = Ya(e, t, 2), e !== null && (ot(e, 2), id(e));
	}
	function X(e, t, n) {
		if (e.tag === 3) Gu(e, e, n);
		else for (; t !== null;) {
			if (t.tag === 3) {
				Gu(t, e, n);
				break;
			}
			if (t.tag === 1) {
				var r = t.stateNode;
				if (typeof t.type.getDerivedStateFromError == "function" || typeof r.componentDidCatch == "function" && (iu === null || !iu.has(r))) {
					e = Ti(n, e), n = tc(2), r = Ya(t, n, 2), r !== null && (nc(n, r, t, e), ot(r, 2), id(r));
					break;
				}
			}
			t = t.return;
		}
	}
	function Ku(e, t, n) {
		var r = e.pingCache;
		if (r === null) {
			r = e.pingCache = new zl();
			var i = /* @__PURE__ */ new Set();
			r.set(t, i);
		} else i = r.get(t), i === void 0 && (i = /* @__PURE__ */ new Set(), r.set(t, i));
		i.has(n) || (Ul = !0, i.add(n), e = qu.bind(null, e, t, n), t.then(e, e));
	}
	function qu(e, t, n) {
		var r = e.pingCache;
		r !== null && r.delete(t), e.pingedLanes |= e.suspendedLanes & n, e.warmLanes &= ~n, K === e && (J & n) === n && (Gl === 4 || Gl === 3 && (J & 62914560) === J && 300 > Fe() - eu ? !(G & 2) && Cu(e, 0) : Jl |= n, Xl === J && (Xl = 0)), id(e);
	}
	function Ju(e, t) {
		t === 0 && (t = it()), e = ui(e, t), e !== null && (ot(e, t), id(e));
	}
	function Yu(e) {
		var t = e.memoizedState, n = 0;
		t !== null && (n = t.retryLane), Ju(e, n);
	}
	function Xu(e, t) {
		var n = 0;
		switch (e.tag) {
			case 31:
			case 13:
				var r = e.stateNode, i = e.memoizedState;
				i !== null && (n = i.retryLane);
				break;
			case 19:
				r = e.stateNode;
				break;
			case 22:
				r = e.stateNode._retryCache;
				break;
			default: throw Error(s(314));
		}
		r !== null && r.delete(t), Ju(e, n);
	}
	function Zu(e, t) {
		return je(e, t);
	}
	var Qu = null, $u = null, ed = !1, td = !1, nd = !1, rd = 0;
	function id(e) {
		e !== $u && e.next === null && ($u === null ? Qu = $u = e : $u = $u.next = e), td = !0, ed || (ed = !0, dd());
	}
	function ad(e, t) {
		if (!nd && td) {
			nd = !0;
			do
				for (var n = !1, r = Qu; r !== null;) {
					if (!t) {
						if (e !== 0) {
							var i = r.pendingLanes;
							if (i === 0) var a = 0;
							else {
								var o = r.suspendedLanes, s = r.pingedLanes;
								a = (1 << 31 - qe(42 | e) + 1) - 1, a &= i & ~(o & ~s), a = a & 201326741 ? a & 201326741 | 1 : a ? a | 2 : 0;
							}
							a !== 0 && (n = !0, ud(r, a));
						} else a = J, a = tt(r, r === K ? a : 0, r.cancelPendingCommit !== null || r.timeoutHandle !== -1), !(a & 3) || nt(r, a) || (n = !0, ud(r, a));
					}
					r = r.next;
				}
			while (n);
			nd = !1;
		}
	}
	function od() {
		sd();
	}
	function sd() {
		td = ed = !1;
		var e = 0;
		rd !== 0 && Gd() && (e = rd);
		for (var t = Fe(), n = null, r = Qu; r !== null;) {
			var i = r.next, a = cd(r, t);
			a === 0 ? (r.next = null, n === null ? Qu = i : n.next = i, i === null && ($u = n)) : (n = r, (e !== 0 || a & 3) && (td = !0)), r = i;
		}
		au !== 0 && au !== 5 || ad(e, !1), rd !== 0 && (rd = 0);
	}
	function cd(e, t) {
		for (var n = e.suspendedLanes, r = e.pingedLanes, i = e.expirationTimes, a = e.pendingLanes & -62914561; 0 < a;) {
			var o = 31 - qe(a), s = 1 << o, c = i[o];
			c === -1 ? ((s & n) === 0 || (s & r) !== 0) && (i[o] = rt(s, t)) : c <= t && (e.expiredLanes |= s), a &= ~s;
		}
		if (t = K, n = J, n = tt(e, e === t ? n : 0, e.cancelPendingCommit !== null || e.timeoutHandle !== -1), r = e.callbackNode, n === 0 || e === t && (Y === 2 || Y === 9) || e.cancelPendingCommit !== null) return r !== null && r !== null && Me(r), e.callbackNode = null, e.callbackPriority = 0;
		if (!(n & 3) || nt(e, n)) {
			if (t = n & -n, t === e.callbackPriority) return t;
			switch (r !== null && Me(r), ft(n)) {
				case 2:
				case 8:
					n = Re;
					break;
				case 32:
					n = ze;
					break;
				case 268435456:
					n = Ve;
					break;
				default: n = ze;
			}
			return r = ld.bind(null, e), n = je(n, r), e.callbackPriority = t, e.callbackNode = n, t;
		}
		return r !== null && r !== null && Me(r), e.callbackPriority = 2, e.callbackNode = null, 2;
	}
	function ld(e, t) {
		if (au !== 0 && au !== 5) return e.callbackNode = null, e.callbackPriority = 0, null;
		var n = e.callbackNode;
		if (Uu() && e.callbackNode !== n) return null;
		var r = J;
		return r = tt(e, e === K ? r : 0, e.cancelPendingCommit !== null || e.timeoutHandle !== -1), r === 0 ? null : (_u(e, r, t), cd(e, Fe()), e.callbackNode != null && e.callbackNode === n ? ld.bind(null, e) : null);
	}
	function ud(e, t) {
		if (Uu()) return null;
		_u(e, t, !0);
	}
	function dd() {
		Yd(function() {
			G & 6 ? je(Le, od) : sd();
		});
	}
	function fd() {
		if (rd === 0) {
			var e = ya;
			e === 0 && (e = Ze, Ze <<= 1, !(Ze & 261888) && (Ze = 256)), rd = e;
		}
		return rd;
	}
	function pd(e) {
		return e == null || typeof e == "symbol" || typeof e == "boolean" ? null : typeof e == "function" ? e : ln("" + e);
	}
	function md(e, t) {
		var n = t.ownerDocument.createElement("input");
		return n.name = t.name, n.value = t.value, e.id && n.setAttribute("form", e.id), t.parentNode.insertBefore(n, t), e = new FormData(e), n.parentNode.removeChild(n), e;
	}
	function hd(e, t, n, r, i) {
		if (t === "submit" && n && n.stateNode === i) {
			var a = pd((i[_t] || null).action), o = r.submitter;
			o && (t = (t = o[_t] || null) ? pd(t.formAction) : o.getAttribute("formAction"), t !== null && (a = t, o = null));
			var s = new kn("action", "action", null, r, i);
			e.push({
				event: s,
				listeners: [{
					instance: null,
					listener: function() {
						if (r.defaultPrevented) {
							if (rd !== 0) {
								var e = o ? md(i, o) : new FormData(i);
								Es(n, {
									pending: !0,
									data: e,
									method: i.method,
									action: a
								}, null, e);
							}
						} else typeof a == "function" && (s.preventDefault(), e = o ? md(i, o) : new FormData(i), Es(n, {
							pending: !0,
							data: e,
							method: i.method,
							action: a
						}, a, e));
					},
					currentTarget: i
				}]
			});
		}
	}
	for (var gd = 0; gd < ti.length; gd++) {
		var _d = ti[gd];
		ni(_d.toLowerCase(), "on" + (_d[0].toUpperCase() + _d.slice(1)));
	}
	ni(qr, "onAnimationEnd"), ni(Jr, "onAnimationIteration"), ni(Yr, "onAnimationStart"), ni("dblclick", "onDoubleClick"), ni("focusin", "onFocus"), ni("focusout", "onBlur"), ni(Xr, "onTransitionRun"), ni(Zr, "onTransitionStart"), ni(Qr, "onTransitionCancel"), ni($r, "onTransitionEnd"), Nt("onMouseEnter", ["mouseout", "mouseover"]), Nt("onMouseLeave", ["mouseout", "mouseover"]), Nt("onPointerEnter", ["pointerout", "pointerover"]), Nt("onPointerLeave", ["pointerout", "pointerover"]), Mt("onChange", "change click focusin focusout input keydown keyup selectionchange".split(" ")), Mt("onSelect", "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" ")), Mt("onBeforeInput", [
		"compositionend",
		"keypress",
		"textInput",
		"paste"
	]), Mt("onCompositionEnd", "compositionend focusout keydown keypress keyup mousedown".split(" ")), Mt("onCompositionStart", "compositionstart focusout keydown keypress keyup mousedown".split(" ")), Mt("onCompositionUpdate", "compositionupdate focusout keydown keypress keyup mousedown".split(" "));
	var vd = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "), yd = new Set("beforetoggle cancel close invalid load scroll scrollend toggle".split(" ").concat(vd));
	function bd(e, t) {
		t = !!(t & 4);
		for (var n = 0; n < e.length; n++) {
			var r = e[n], i = r.event;
			r = r.listeners;
			a: {
				var a = void 0;
				if (t) for (var o = r.length - 1; 0 <= o; o--) {
					var s = r[o], c = s.instance, l = s.currentTarget;
					if (s = s.listener, c !== a && i.isPropagationStopped()) break a;
					a = s, i.currentTarget = l;
					try {
						a(i);
					} catch (e) {
						ri(e);
					}
					i.currentTarget = null, a = c;
				}
				else for (o = 0; o < r.length; o++) {
					if (s = r[o], c = s.instance, l = s.currentTarget, s = s.listener, c !== a && i.isPropagationStopped()) break a;
					a = s, i.currentTarget = l;
					try {
						a(i);
					} catch (e) {
						ri(e);
					}
					i.currentTarget = null, a = c;
				}
			}
		}
	}
	function Z(e, t) {
		var n = t[yt];
		n === void 0 && (n = t[yt] = /* @__PURE__ */ new Set());
		var r = e + "__bubble";
		n.has(r) || (wd(t, e, 2, !1), n.add(r));
	}
	function xd(e, t, n) {
		var r = 0;
		t && (r |= 4), wd(n, e, r, t);
	}
	var Sd = "_reactListening" + Math.random().toString(36).slice(2);
	function Cd(e) {
		if (!e[Sd]) {
			e[Sd] = !0, At.forEach(function(t) {
				t !== "selectionchange" && (yd.has(t) || xd(t, !1, e), xd(t, !0, e));
			});
			var t = e.nodeType === 9 ? e : e.ownerDocument;
			t === null || t[Sd] || (t[Sd] = !0, xd("selectionchange", !1, t));
		}
	}
	function wd(e, t, n, r) {
		switch (mp(t)) {
			case 2:
				var i = cp;
				break;
			case 8:
				i = lp;
				break;
			default: i = up;
		}
		n = i.bind(null, t, n, e), i = void 0, !vn || t !== "touchstart" && t !== "touchmove" && t !== "wheel" || (i = !0), r ? i === void 0 ? e.addEventListener(t, n, !0) : e.addEventListener(t, n, {
			capture: !0,
			passive: i
		}) : i === void 0 ? e.addEventListener(t, n, !1) : e.addEventListener(t, n, { passive: i });
	}
	function Td(e, t, n, r, i) {
		var a = r;
		if (!(t & 1) && !(t & 2) && r !== null) a: for (;;) {
			if (r === null) return;
			var o = r.tag;
			if (o === 3 || o === 4) {
				var s = r.stateNode.containerInfo;
				if (s === i) break;
				if (o === 4) for (o = r.return; o !== null;) {
					var c = o.tag;
					if ((c === 3 || c === 4) && o.stateNode.containerInfo === i) return;
					o = o.return;
				}
				for (; s !== null;) {
					if (o = Tt(s), o === null) return;
					if (c = o.tag, c === 5 || c === 6 || c === 26 || c === 27) {
						r = a = o;
						continue a;
					}
					s = s.parentNode;
				}
			}
			r = r.return;
		}
		hn(function() {
			var r = a, i = dn(n), o = [];
			a: {
				var s = ei.get(e);
				if (s !== void 0) {
					var c = kn, u = e;
					switch (e) {
						case "keypress": if (wn(n) === 0) break a;
						case "keydown":
						case "keyup":
							c = qn;
							break;
						case "focusin":
							u = "focus", c = Rn;
							break;
						case "focusout":
							u = "blur", c = Rn;
							break;
						case "beforeblur":
						case "afterblur":
							c = Rn;
							break;
						case "click": if (n.button === 2) break a;
						case "auxclick":
						case "dblclick":
						case "mousedown":
						case "mousemove":
						case "mouseup":
						case "mouseout":
						case "mouseover":
						case "contextmenu":
							c = In;
							break;
						case "drag":
						case "dragend":
						case "dragenter":
						case "dragexit":
						case "dragleave":
						case "dragover":
						case "dragstart":
						case "drop":
							c = Ln;
							break;
						case "touchcancel":
						case "touchend":
						case "touchmove":
						case "touchstart":
							c = Yn;
							break;
						case qr:
						case Jr:
						case Yr:
							c = zn;
							break;
						case $r:
							c = Xn;
							break;
						case "scroll":
						case "scrollend":
							c = jn;
							break;
						case "wheel":
							c = Zn;
							break;
						case "copy":
						case "cut":
						case "paste":
							c = Bn;
							break;
						case "gotpointercapture":
						case "lostpointercapture":
						case "pointercancel":
						case "pointerdown":
						case "pointermove":
						case "pointerout":
						case "pointerover":
						case "pointerup":
							c = Jn;
							break;
						case "toggle":
						case "beforetoggle": c = Qn;
					}
					var d = !!(t & 4), f = !d && (e === "scroll" || e === "scrollend"), p = d ? s === null ? null : s + "Capture" : s;
					d = [];
					for (var m = r, h; m !== null;) {
						var g = m;
						if (h = g.stateNode, g = g.tag, g !== 5 && g !== 26 && g !== 27 || h === null || p === null || (g = gn(m, p), g != null && d.push(Ed(m, g, h))), f) break;
						m = m.return;
					}
					0 < d.length && (s = new c(s, u, null, n, i), o.push({
						event: s,
						listeners: d
					}));
				}
			}
			if (!(t & 7)) {
				a: {
					if (s = e === "mouseover" || e === "pointerover", c = e === "mouseout" || e === "pointerout", s && n !== k && (u = n.relatedTarget || n.fromElement) && (Tt(u) || u[vt])) break a;
					if ((c || s) && (s = i.window === i ? i : (s = i.ownerDocument) ? s.defaultView || s.parentWindow : window, c ? (u = n.relatedTarget || n.toElement, c = r, u = u ? Tt(u) : null, u !== null && (f = l(u), d = u.tag, u !== f || d !== 5 && d !== 27 && d !== 6) && (u = null)) : (c = null, u = r), c !== u)) {
						if (d = In, g = "onMouseLeave", p = "onMouseEnter", m = "mouse", (e === "pointerout" || e === "pointerover") && (d = Jn, g = "onPointerLeave", p = "onPointerEnter", m = "pointer"), f = c == null ? s : Dt(c), h = u == null ? s : Dt(u), s = new d(g, m + "leave", c, n, i), s.target = f, s.relatedTarget = h, g = null, Tt(i) === r && (d = new d(p, m + "enter", u, n, i), d.target = h, d.relatedTarget = f, g = d), f = g, c && u) b: {
							for (d = Od, p = c, m = u, h = 0, g = p; g; g = d(g)) h++;
							g = 0;
							for (var _ = m; _; _ = d(_)) g++;
							for (; 0 < h - g;) p = d(p), h--;
							for (; 0 < g - h;) m = d(m), g--;
							for (; h--;) {
								if (p === m || m !== null && p === m.alternate) {
									d = p;
									break b;
								}
								p = d(p), m = d(m);
							}
							d = null;
						}
						else d = null;
						c !== null && kd(o, s, c, d, !1), u !== null && f !== null && kd(o, f, u, d, !0);
					}
				}
				a: {
					if (s = r ? Dt(r) : window, c = s.nodeName && s.nodeName.toLowerCase(), c === "select" || c === "input" && s.type === "file") var v = _r;
					else if (dr(s)) {
						if (vr) v = Dr;
						else {
							v = Tr;
							var y = wr;
						}
					} else c = s.nodeName, !c || c.toLowerCase() !== "input" || s.type !== "checkbox" && s.type !== "radio" ? r && on(r.elementType) && (v = _r) : v = Er;
					if (v &&= v(e, r)) {
						fr(o, v, n, i);
						break a;
					}
					y && y(e, s, r), e === "focusout" && r && s.type === "number" && r.memoizedProps.value != null && Zt(s, "number", s.value);
				}
				switch (y = r ? Dt(r) : window, e) {
					case "focusin":
						(dr(y) || y.contentEditable === "true") && (Lr = y, Rr = r, zr = null);
						break;
					case "focusout":
						zr = Rr = Lr = null;
						break;
					case "mousedown":
						Br = !0;
						break;
					case "contextmenu":
					case "mouseup":
					case "dragend":
						Br = !1, Vr(o, n, i);
						break;
					case "selectionchange": if (Ir) break;
					case "keydown":
					case "keyup": Vr(o, n, i);
				}
				var b;
				if (er) b: {
					switch (e) {
						case "compositionstart":
							var x = "onCompositionStart";
							break b;
						case "compositionend":
							x = "onCompositionEnd";
							break b;
						case "compositionupdate":
							x = "onCompositionUpdate";
							break b;
					}
					x = void 0;
				}
				else sr ? ar(e, n) && (x = "onCompositionEnd") : e === "keydown" && n.keyCode === 229 && (x = "onCompositionStart");
				x && (j && n.locale !== "ko" && (sr || x !== "onCompositionStart" ? x === "onCompositionEnd" && sr && (b = Cn()) : (bn = i, xn = "value" in bn ? bn.value : bn.textContent, sr = !0)), y = Dd(r, x), 0 < y.length && (x = new Vn(x, e, null, n, i), o.push({
					event: x,
					listeners: y
				}), b ? x.data = b : (b = or(n), b !== null && (x.data = b)))), (b = nr ? cr(e, n) : lr(e, n)) && (x = Dd(r, "onBeforeInput"), 0 < x.length && (y = new Vn("onBeforeInput", "beforeinput", null, n, i), o.push({
					event: y,
					listeners: x
				}), y.data = b)), hd(o, e, r, n, i);
			}
			bd(o, t);
		});
	}
	function Ed(e, t, n) {
		return {
			instance: e,
			listener: t,
			currentTarget: n
		};
	}
	function Dd(e, t) {
		for (var n = t + "Capture", r = []; e !== null;) {
			var i = e, a = i.stateNode;
			if (i = i.tag, i !== 5 && i !== 26 && i !== 27 || a === null || (i = gn(e, n), i != null && r.unshift(Ed(e, i, a)), i = gn(e, t), i != null && r.push(Ed(e, i, a))), e.tag === 3) return r;
			e = e.return;
		}
		return [];
	}
	function Od(e) {
		if (e === null) return null;
		do
			e = e.return;
		while (e && e.tag !== 5 && e.tag !== 27);
		return e || null;
	}
	function kd(e, t, n, r, i) {
		for (var a = t._reactName, o = []; n !== null && n !== r;) {
			var s = n, c = s.alternate, l = s.stateNode;
			if (s = s.tag, c !== null && c === r) break;
			s !== 5 && s !== 26 && s !== 27 || l === null || (c = l, i ? (l = gn(n, a), l != null && o.unshift(Ed(n, l, c))) : i || (l = gn(n, a), l != null && o.push(Ed(n, l, c)))), n = n.return;
		}
		o.length !== 0 && e.push({
			event: t,
			listeners: o
		});
	}
	var Ad = /\r\n?/g, jd = /\u0000|\uFFFD/g;
	function Md(e) {
		return (typeof e == "string" ? e : "" + e).replace(Ad, "\n").replace(jd, "");
	}
	function Nd(e, t) {
		return t = Md(t), Md(e) === t;
	}
	function Q(e, t, n, r, i, a) {
		switch (n) {
			case "children":
				typeof r == "string" ? t === "body" || t === "textarea" && r === "" || tn(e, r) : (typeof r == "number" || typeof r == "bigint") && t !== "body" && tn(e, "" + r);
				break;
			case "className":
				zt(e, "class", r);
				break;
			case "tabIndex":
				zt(e, "tabindex", r);
				break;
			case "dir":
			case "role":
			case "viewBox":
			case "width":
			case "height":
				zt(e, n, r);
				break;
			case "style":
				an(e, r, a);
				break;
			case "data": if (t !== "object") {
				zt(e, "data", r);
				break;
			}
			case "src":
			case "href":
				if (r === "" && (t !== "a" || n !== "href")) {
					e.removeAttribute(n);
					break;
				}
				if (r == null || typeof r == "function" || typeof r == "symbol" || typeof r == "boolean") {
					e.removeAttribute(n);
					break;
				}
				r = ln("" + r), e.setAttribute(n, r);
				break;
			case "action":
			case "formAction":
				if (typeof r == "function") {
					e.setAttribute(n, "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')");
					break;
				}
				if (typeof a == "function" && (n === "formAction" ? (t !== "input" && Q(e, t, "name", i.name, i, null), Q(e, t, "formEncType", i.formEncType, i, null), Q(e, t, "formMethod", i.formMethod, i, null), Q(e, t, "formTarget", i.formTarget, i, null)) : (Q(e, t, "encType", i.encType, i, null), Q(e, t, "method", i.method, i, null), Q(e, t, "target", i.target, i, null))), r == null || typeof r == "symbol" || typeof r == "boolean") {
					e.removeAttribute(n);
					break;
				}
				r = ln("" + r), e.setAttribute(n, r);
				break;
			case "onClick":
				r != null && (e.onclick = un);
				break;
			case "onScroll":
				r != null && Z("scroll", e);
				break;
			case "onScrollEnd":
				r != null && Z("scrollend", e);
				break;
			case "dangerouslySetInnerHTML":
				if (r != null) {
					if (typeof r != "object" || !("__html" in r)) throw Error(s(61));
					if (n = r.__html, n != null) {
						if (i.children != null) throw Error(s(60));
						e.innerHTML = n;
					}
				}
				break;
			case "multiple":
				e.multiple = r && typeof r != "function" && typeof r != "symbol";
				break;
			case "muted":
				e.muted = r && typeof r != "function" && typeof r != "symbol";
				break;
			case "suppressContentEditableWarning":
			case "suppressHydrationWarning":
			case "defaultValue":
			case "defaultChecked":
			case "innerHTML":
			case "ref": break;
			case "autoFocus": break;
			case "xlinkHref":
				if (r == null || typeof r == "function" || typeof r == "boolean" || typeof r == "symbol") {
					e.removeAttribute("xlink:href");
					break;
				}
				n = ln("" + r), e.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", n);
				break;
			case "contentEditable":
			case "spellCheck":
			case "draggable":
			case "value":
			case "autoReverse":
			case "externalResourcesRequired":
			case "focusable":
			case "preserveAlpha":
				r != null && typeof r != "function" && typeof r != "symbol" ? e.setAttribute(n, "" + r) : e.removeAttribute(n);
				break;
			case "inert":
			case "allowFullScreen":
			case "async":
			case "autoPlay":
			case "controls":
			case "default":
			case "defer":
			case "disabled":
			case "disablePictureInPicture":
			case "disableRemotePlayback":
			case "formNoValidate":
			case "hidden":
			case "loop":
			case "noModule":
			case "noValidate":
			case "open":
			case "playsInline":
			case "readOnly":
			case "required":
			case "reversed":
			case "scoped":
			case "seamless":
			case "itemScope":
				r && typeof r != "function" && typeof r != "symbol" ? e.setAttribute(n, "") : e.removeAttribute(n);
				break;
			case "capture":
			case "download":
				!0 === r ? e.setAttribute(n, "") : !1 !== r && r != null && typeof r != "function" && typeof r != "symbol" ? e.setAttribute(n, r) : e.removeAttribute(n);
				break;
			case "cols":
			case "rows":
			case "size":
			case "span":
				r != null && typeof r != "function" && typeof r != "symbol" && !isNaN(r) && 1 <= r ? e.setAttribute(n, r) : e.removeAttribute(n);
				break;
			case "rowSpan":
			case "start":
				r == null || typeof r == "function" || typeof r == "symbol" || isNaN(r) ? e.removeAttribute(n) : e.setAttribute(n, r);
				break;
			case "popover":
				Z("beforetoggle", e), Z("toggle", e), Rt(e, "popover", r);
				break;
			case "xlinkActuate":
				Bt(e, "http://www.w3.org/1999/xlink", "xlink:actuate", r);
				break;
			case "xlinkArcrole":
				Bt(e, "http://www.w3.org/1999/xlink", "xlink:arcrole", r);
				break;
			case "xlinkRole":
				Bt(e, "http://www.w3.org/1999/xlink", "xlink:role", r);
				break;
			case "xlinkShow":
				Bt(e, "http://www.w3.org/1999/xlink", "xlink:show", r);
				break;
			case "xlinkTitle":
				Bt(e, "http://www.w3.org/1999/xlink", "xlink:title", r);
				break;
			case "xlinkType":
				Bt(e, "http://www.w3.org/1999/xlink", "xlink:type", r);
				break;
			case "xmlBase":
				Bt(e, "http://www.w3.org/XML/1998/namespace", "xml:base", r);
				break;
			case "xmlLang":
				Bt(e, "http://www.w3.org/XML/1998/namespace", "xml:lang", r);
				break;
			case "xmlSpace":
				Bt(e, "http://www.w3.org/XML/1998/namespace", "xml:space", r);
				break;
			case "is":
				Rt(e, "is", r);
				break;
			case "innerText":
			case "textContent": break;
			default: (!(2 < n.length) || n[0] !== "o" && n[0] !== "O" || n[1] !== "n" && n[1] !== "N") && (n = sn.get(n) || n, Rt(e, n, r));
		}
	}
	function Pd(e, t, n, r, i, a) {
		switch (n) {
			case "style":
				an(e, r, a);
				break;
			case "dangerouslySetInnerHTML":
				if (r != null) {
					if (typeof r != "object" || !("__html" in r)) throw Error(s(61));
					if (n = r.__html, n != null) {
						if (i.children != null) throw Error(s(60));
						e.innerHTML = n;
					}
				}
				break;
			case "children":
				typeof r == "string" ? tn(e, r) : (typeof r == "number" || typeof r == "bigint") && tn(e, "" + r);
				break;
			case "onScroll":
				r != null && Z("scroll", e);
				break;
			case "onScrollEnd":
				r != null && Z("scrollend", e);
				break;
			case "onClick":
				r != null && (e.onclick = un);
				break;
			case "suppressContentEditableWarning":
			case "suppressHydrationWarning":
			case "innerHTML":
			case "ref": break;
			case "innerText":
			case "textContent": break;
			default: if (!jt.hasOwnProperty(n)) a: {
				if (n[0] === "o" && n[1] === "n" && (i = n.endsWith("Capture"), t = n.slice(2, i ? n.length - 7 : void 0), a = e[_t] || null, a = a == null ? null : a[n], typeof a == "function" && e.removeEventListener(t, a, i), typeof r == "function")) {
					typeof a != "function" && a !== null && (n in e ? e[n] = null : e.hasAttribute(n) && e.removeAttribute(n)), e.addEventListener(t, r, i);
					break a;
				}
				n in e ? e[n] = r : !0 === r ? e.setAttribute(n, "") : Rt(e, n, r);
			}
		}
	}
	function $(e, t, n) {
		switch (t) {
			case "div":
			case "span":
			case "svg":
			case "path":
			case "a":
			case "g":
			case "p":
			case "li": break;
			case "img":
				Z("error", e), Z("load", e);
				var r = !1, i = !1, a;
				for (a in n) if (n.hasOwnProperty(a)) {
					var o = n[a];
					if (o != null) switch (a) {
						case "src":
							r = !0;
							break;
						case "srcSet":
							i = !0;
							break;
						case "children":
						case "dangerouslySetInnerHTML": throw Error(s(137, t));
						default: Q(e, t, a, o, n, null);
					}
				}
				i && Q(e, t, "srcSet", n.srcSet, n, null), r && Q(e, t, "src", n.src, n, null);
				return;
			case "input":
				Z("invalid", e);
				var c = a = o = i = null, l = null, u = null;
				for (r in n) if (n.hasOwnProperty(r)) {
					var d = n[r];
					if (d != null) switch (r) {
						case "name":
							i = d;
							break;
						case "type":
							o = d;
							break;
						case "checked":
							l = d;
							break;
						case "defaultChecked":
							u = d;
							break;
						case "value":
							a = d;
							break;
						case "defaultValue":
							c = d;
							break;
						case "children":
						case "dangerouslySetInnerHTML":
							if (d != null) throw Error(s(137, t));
							break;
						default: Q(e, t, r, d, n, null);
					}
				}
				Xt(e, a, c, l, u, o, i, !1);
				return;
			case "select":
				for (i in Z("invalid", e), r = o = a = null, n) if (n.hasOwnProperty(i) && (c = n[i], c != null)) switch (i) {
					case "value":
						a = c;
						break;
					case "defaultValue":
						o = c;
						break;
					case "multiple": r = c;
					default: Q(e, t, i, c, n, null);
				}
				t = a, n = o, e.multiple = !!r, t == null ? n != null && Qt(e, !!r, n, !0) : Qt(e, !!r, t, !1);
				return;
			case "textarea":
				for (o in Z("invalid", e), a = i = r = null, n) if (n.hasOwnProperty(o) && (c = n[o], c != null)) switch (o) {
					case "value":
						r = c;
						break;
					case "defaultValue":
						i = c;
						break;
					case "children":
						a = c;
						break;
					case "dangerouslySetInnerHTML":
						if (c != null) throw Error(s(91));
						break;
					default: Q(e, t, o, c, n, null);
				}
				en(e, r, i, a);
				return;
			case "option":
				for (l in n) if (n.hasOwnProperty(l) && (r = n[l], r != null)) switch (l) {
					case "selected":
						e.selected = r && typeof r != "function" && typeof r != "symbol";
						break;
					default: Q(e, t, l, r, n, null);
				}
				return;
			case "dialog":
				Z("beforetoggle", e), Z("toggle", e), Z("cancel", e), Z("close", e);
				break;
			case "iframe":
			case "object":
				Z("load", e);
				break;
			case "video":
			case "audio":
				for (r = 0; r < vd.length; r++) Z(vd[r], e);
				break;
			case "image":
				Z("error", e), Z("load", e);
				break;
			case "details":
				Z("toggle", e);
				break;
			case "embed":
			case "source":
			case "link": Z("error", e), Z("load", e);
			case "area":
			case "base":
			case "br":
			case "col":
			case "hr":
			case "keygen":
			case "meta":
			case "param":
			case "track":
			case "wbr":
			case "menuitem":
				for (u in n) if (n.hasOwnProperty(u) && (r = n[u], r != null)) switch (u) {
					case "children":
					case "dangerouslySetInnerHTML": throw Error(s(137, t));
					default: Q(e, t, u, r, n, null);
				}
				return;
			default: if (on(t)) {
				for (d in n) n.hasOwnProperty(d) && (r = n[d], r !== void 0 && Pd(e, t, d, r, n, void 0));
				return;
			}
		}
		for (c in n) n.hasOwnProperty(c) && (r = n[c], r != null && Q(e, t, c, r, n, null));
	}
	function Fd(e, t, n, r) {
		switch (t) {
			case "div":
			case "span":
			case "svg":
			case "path":
			case "a":
			case "g":
			case "p":
			case "li": break;
			case "input":
				var i = null, a = null, o = null, c = null, l = null, u = null, d = null;
				for (m in n) {
					var f = n[m];
					if (n.hasOwnProperty(m) && f != null) switch (m) {
						case "checked": break;
						case "value": break;
						case "defaultValue": l = f;
						default: r.hasOwnProperty(m) || Q(e, t, m, null, r, f);
					}
				}
				for (var p in r) {
					var m = r[p];
					if (f = n[p], r.hasOwnProperty(p) && (m != null || f != null)) switch (p) {
						case "type":
							a = m;
							break;
						case "name":
							i = m;
							break;
						case "checked":
							u = m;
							break;
						case "defaultChecked":
							d = m;
							break;
						case "value":
							o = m;
							break;
						case "defaultValue":
							c = m;
							break;
						case "children":
						case "dangerouslySetInnerHTML":
							if (m != null) throw Error(s(137, t));
							break;
						default: m !== f && Q(e, t, p, m, r, f);
					}
				}
				Yt(e, o, c, l, u, d, a, i);
				return;
			case "select":
				for (a in m = o = c = p = null, n) if (l = n[a], n.hasOwnProperty(a) && l != null) switch (a) {
					case "value": break;
					case "multiple": m = l;
					default: r.hasOwnProperty(a) || Q(e, t, a, null, r, l);
				}
				for (i in r) if (a = r[i], l = n[i], r.hasOwnProperty(i) && (a != null || l != null)) switch (i) {
					case "value":
						p = a;
						break;
					case "defaultValue":
						c = a;
						break;
					case "multiple": o = a;
					default: a !== l && Q(e, t, i, a, r, l);
				}
				t = c, n = o, r = m, p == null ? !!r != !!n && (t == null ? Qt(e, !!n, n ? [] : "", !1) : Qt(e, !!n, t, !0)) : Qt(e, !!n, p, !1);
				return;
			case "textarea":
				for (c in m = p = null, n) if (i = n[c], n.hasOwnProperty(c) && i != null && !r.hasOwnProperty(c)) switch (c) {
					case "value": break;
					case "children": break;
					default: Q(e, t, c, null, r, i);
				}
				for (o in r) if (i = r[o], a = n[o], r.hasOwnProperty(o) && (i != null || a != null)) switch (o) {
					case "value":
						p = i;
						break;
					case "defaultValue":
						m = i;
						break;
					case "children": break;
					case "dangerouslySetInnerHTML":
						if (i != null) throw Error(s(91));
						break;
					default: i !== a && Q(e, t, o, i, r, a);
				}
				$t(e, p, m);
				return;
			case "option":
				for (var h in n) if (p = n[h], n.hasOwnProperty(h) && p != null && !r.hasOwnProperty(h)) switch (h) {
					case "selected":
						e.selected = !1;
						break;
					default: Q(e, t, h, null, r, p);
				}
				for (l in r) if (p = r[l], m = n[l], r.hasOwnProperty(l) && p !== m && (p != null || m != null)) switch (l) {
					case "selected":
						e.selected = p && typeof p != "function" && typeof p != "symbol";
						break;
					default: Q(e, t, l, p, r, m);
				}
				return;
			case "img":
			case "link":
			case "area":
			case "base":
			case "br":
			case "col":
			case "embed":
			case "hr":
			case "keygen":
			case "meta":
			case "param":
			case "source":
			case "track":
			case "wbr":
			case "menuitem":
				for (var g in n) p = n[g], n.hasOwnProperty(g) && p != null && !r.hasOwnProperty(g) && Q(e, t, g, null, r, p);
				for (u in r) if (p = r[u], m = n[u], r.hasOwnProperty(u) && p !== m && (p != null || m != null)) switch (u) {
					case "children":
					case "dangerouslySetInnerHTML":
						if (p != null) throw Error(s(137, t));
						break;
					default: Q(e, t, u, p, r, m);
				}
				return;
			default: if (on(t)) {
				for (var _ in n) p = n[_], n.hasOwnProperty(_) && p !== void 0 && !r.hasOwnProperty(_) && Pd(e, t, _, void 0, r, p);
				for (d in r) p = r[d], m = n[d], !r.hasOwnProperty(d) || p === m || p === void 0 && m === void 0 || Pd(e, t, d, p, r, m);
				return;
			}
		}
		for (var v in n) p = n[v], n.hasOwnProperty(v) && p != null && !r.hasOwnProperty(v) && Q(e, t, v, null, r, p);
		for (f in r) p = r[f], m = n[f], !r.hasOwnProperty(f) || p === m || p == null && m == null || Q(e, t, f, p, r, m);
	}
	function Id(e) {
		switch (e) {
			case "css":
			case "script":
			case "font":
			case "img":
			case "image":
			case "input":
			case "link": return !0;
			default: return !1;
		}
	}
	function Ld() {
		if (typeof performance.getEntriesByType == "function") {
			for (var e = 0, t = 0, n = performance.getEntriesByType("resource"), r = 0; r < n.length; r++) {
				var i = n[r], a = i.transferSize, o = i.initiatorType, s = i.duration;
				if (a && s && Id(o)) {
					for (o = 0, s = i.responseEnd, r += 1; r < n.length; r++) {
						var c = n[r], l = c.startTime;
						if (l > s) break;
						var u = c.transferSize, d = c.initiatorType;
						u && Id(d) && (c = c.responseEnd, o += u * (c < s ? 1 : (s - l) / (c - l)));
					}
					if (--r, t += 8 * (a + o) / (i.duration / 1e3), e++, 10 < e) break;
				}
			}
			if (0 < e) return t / e / 1e6;
		}
		return navigator.connection && (e = navigator.connection.downlink, typeof e == "number") ? e : 5;
	}
	var Rd = null, zd = null;
	function Bd(e) {
		return e.nodeType === 9 ? e : e.ownerDocument;
	}
	function Vd(e) {
		switch (e) {
			case "http://www.w3.org/2000/svg": return 1;
			case "http://www.w3.org/1998/Math/MathML": return 2;
			default: return 0;
		}
	}
	function Hd(e, t) {
		if (e === 0) switch (t) {
			case "svg": return 1;
			case "math": return 2;
			default: return 0;
		}
		return e === 1 && t === "foreignObject" ? 0 : e;
	}
	function Ud(e, t) {
		return e === "textarea" || e === "noscript" || typeof t.children == "string" || typeof t.children == "number" || typeof t.children == "bigint" || typeof t.dangerouslySetInnerHTML == "object" && t.dangerouslySetInnerHTML !== null && t.dangerouslySetInnerHTML.__html != null;
	}
	var Wd = null;
	function Gd() {
		var e = window.event;
		return e && e.type === "popstate" ? e !== Wd && (Wd = e, !0) : (Wd = null, !1);
	}
	var Kd = typeof setTimeout == "function" ? setTimeout : void 0, qd = typeof clearTimeout == "function" ? clearTimeout : void 0, Jd = typeof Promise == "function" ? Promise : void 0, Yd = typeof queueMicrotask == "function" ? queueMicrotask : Jd === void 0 ? Kd : function(e) {
		return Jd.resolve(null).then(e).catch(Xd);
	};
	function Xd(e) {
		setTimeout(function() {
			throw e;
		});
	}
	function Zd(e) {
		return e === "head";
	}
	function Qd(e, t) {
		var n = t, r = 0;
		do {
			var i = n.nextSibling;
			if (e.removeChild(n), i && i.nodeType === 8) {
				if (n = i.data, n === "/$" || n === "/&") {
					if (r === 0) {
						e.removeChild(i), Np(t);
						return;
					}
					r--;
				} else if (n === "$" || n === "$?" || n === "$~" || n === "$!" || n === "&") r++;
				else if (n === "html") pf(e.ownerDocument.documentElement);
				else if (n === "head") {
					n = e.ownerDocument.head, pf(n);
					for (var a = n.firstChild; a;) {
						var o = a.nextSibling, s = a.nodeName;
						a[Ct] || s === "SCRIPT" || s === "STYLE" || s === "LINK" && a.rel.toLowerCase() === "stylesheet" || n.removeChild(a), a = o;
					}
				} else n === "body" && pf(e.ownerDocument.body);
			}
			n = i;
		} while (n);
		Np(t);
	}
	function $d(e, t) {
		var n = e;
		e = 0;
		do {
			var r = n.nextSibling;
			if (n.nodeType === 1 ? t ? (n._stashedDisplay = n.style.display, n.style.display = "none") : (n.style.display = n._stashedDisplay || "", n.getAttribute("style") === "" && n.removeAttribute("style")) : n.nodeType === 3 && (t ? (n._stashedText = n.nodeValue, n.nodeValue = "") : n.nodeValue = n._stashedText || ""), r && r.nodeType === 8) {
				if (n = r.data, n === "/$") {
					if (e === 0) break;
					e--;
				} else n !== "$" && n !== "$?" && n !== "$~" && n !== "$!" || e++;
			}
			n = r;
		} while (n);
	}
	function ef(e) {
		var t = e.firstChild;
		for (t && t.nodeType === 10 && (t = t.nextSibling); t;) {
			var n = t;
			switch (t = t.nextSibling, n.nodeName) {
				case "HTML":
				case "HEAD":
				case "BODY":
					ef(n), wt(n);
					continue;
				case "SCRIPT":
				case "STYLE": continue;
				case "LINK": if (n.rel.toLowerCase() === "stylesheet") continue;
			}
			e.removeChild(n);
		}
	}
	function tf(e, t, n, r) {
		for (; e.nodeType === 1;) {
			var i = n;
			if (e.nodeName.toLowerCase() !== t.toLowerCase()) {
				if (!r && (e.nodeName !== "INPUT" || e.type !== "hidden")) break;
			} else if (!r) {
				if (t === "input" && e.type === "hidden") {
					var a = i.name == null ? null : "" + i.name;
					if (i.type === "hidden" && e.getAttribute("name") === a) return e;
				} else return e;
			} else if (!e[Ct]) switch (t) {
				case "meta":
					if (!e.hasAttribute("itemprop")) break;
					return e;
				case "link":
					if (a = e.getAttribute("rel"), a === "stylesheet" && e.hasAttribute("data-precedence") || a !== i.rel || e.getAttribute("href") !== (i.href == null || i.href === "" ? null : i.href) || e.getAttribute("crossorigin") !== (i.crossOrigin == null ? null : i.crossOrigin) || e.getAttribute("title") !== (i.title == null ? null : i.title)) break;
					return e;
				case "style":
					if (e.hasAttribute("data-precedence")) break;
					return e;
				case "script":
					if (a = e.getAttribute("src"), (a !== (i.src == null ? null : i.src) || e.getAttribute("type") !== (i.type == null ? null : i.type) || e.getAttribute("crossorigin") !== (i.crossOrigin == null ? null : i.crossOrigin)) && a && e.hasAttribute("async") && !e.hasAttribute("itemprop")) break;
					return e;
				default: return e;
			}
			if (e = cf(e.nextSibling), e === null) break;
		}
		return null;
	}
	function nf(e, t, n) {
		if (t === "") return null;
		for (; e.nodeType !== 3;) if ((e.nodeType !== 1 || e.nodeName !== "INPUT" || e.type !== "hidden") && !n || (e = cf(e.nextSibling), e === null)) return null;
		return e;
	}
	function rf(e, t) {
		for (; e.nodeType !== 8;) if ((e.nodeType !== 1 || e.nodeName !== "INPUT" || e.type !== "hidden") && !t || (e = cf(e.nextSibling), e === null)) return null;
		return e;
	}
	function af(e) {
		return e.data === "$?" || e.data === "$~";
	}
	function of(e) {
		return e.data === "$!" || e.data === "$?" && e.ownerDocument.readyState !== "loading";
	}
	function sf(e, t) {
		var n = e.ownerDocument;
		if (e.data === "$~") e._reactRetry = t;
		else if (e.data !== "$?" || n.readyState !== "loading") t();
		else {
			var r = function() {
				t(), n.removeEventListener("DOMContentLoaded", r);
			};
			n.addEventListener("DOMContentLoaded", r), e._reactRetry = r;
		}
	}
	function cf(e) {
		for (; e != null; e = e.nextSibling) {
			var t = e.nodeType;
			if (t === 1 || t === 3) break;
			if (t === 8) {
				if (t = e.data, t === "$" || t === "$!" || t === "$?" || t === "$~" || t === "&" || t === "F!" || t === "F") break;
				if (t === "/$" || t === "/&") return null;
			}
		}
		return e;
	}
	var lf = null;
	function uf(e) {
		e = e.nextSibling;
		for (var t = 0; e;) {
			if (e.nodeType === 8) {
				var n = e.data;
				if (n === "/$" || n === "/&") {
					if (t === 0) return cf(e.nextSibling);
					t--;
				} else n !== "$" && n !== "$!" && n !== "$?" && n !== "$~" && n !== "&" || t++;
			}
			e = e.nextSibling;
		}
		return null;
	}
	function df(e) {
		e = e.previousSibling;
		for (var t = 0; e;) {
			if (e.nodeType === 8) {
				var n = e.data;
				if (n === "$" || n === "$!" || n === "$?" || n === "$~" || n === "&") {
					if (t === 0) return e;
					t--;
				} else n !== "/$" && n !== "/&" || t++;
			}
			e = e.previousSibling;
		}
		return null;
	}
	function ff(e, t, n) {
		switch (t = Bd(n), e) {
			case "html":
				if (e = t.documentElement, !e) throw Error(s(452));
				return e;
			case "head":
				if (e = t.head, !e) throw Error(s(453));
				return e;
			case "body":
				if (e = t.body, !e) throw Error(s(454));
				return e;
			default: throw Error(s(451));
		}
	}
	function pf(e) {
		for (var t = e.attributes; t.length;) e.removeAttributeNode(t[0]);
		wt(e);
	}
	var mf = /* @__PURE__ */ new Map(), hf = /* @__PURE__ */ new Set();
	function gf(e) {
		return typeof e.getRootNode == "function" ? e.getRootNode() : e.nodeType === 9 ? e : e.ownerDocument;
	}
	var _f = D.d;
	D.d = {
		f: vf,
		r: yf,
		D: Sf,
		C: Cf,
		L: wf,
		m: Tf,
		X: Df,
		S: Ef,
		M: Of
	};
	function vf() {
		var e = _f.f(), t = xu();
		return e || t;
	}
	function yf(e) {
		var t = Et(e);
		t !== null && t.tag === 5 && t.type === "form" ? Os(t) : _f.r(e);
	}
	var bf = typeof document > "u" ? null : document;
	function xf(e, t, n) {
		var r = bf;
		if (r && typeof t == "string" && t) {
			var i = Jt(t);
			i = "link[rel=\"" + e + "\"][href=\"" + i + "\"]", typeof n == "string" && (i += "[crossorigin=\"" + n + "\"]"), hf.has(i) || (hf.add(i), e = {
				rel: e,
				crossOrigin: n,
				href: t
			}, r.querySelector(i) === null && (t = r.createElement("link"), $(t, "link", e), kt(t), r.head.appendChild(t)));
		}
	}
	function Sf(e) {
		_f.D(e), xf("dns-prefetch", e, null);
	}
	function Cf(e, t) {
		_f.C(e, t), xf("preconnect", e, t);
	}
	function wf(e, t, n) {
		_f.L(e, t, n);
		var r = bf;
		if (r && e && t) {
			var i = "link[rel=\"preload\"][as=\"" + Jt(t) + "\"]";
			t === "image" && n && n.imageSrcSet ? (i += "[imagesrcset=\"" + Jt(n.imageSrcSet) + "\"]", typeof n.imageSizes == "string" && (i += "[imagesizes=\"" + Jt(n.imageSizes) + "\"]")) : i += "[href=\"" + Jt(e) + "\"]";
			var a = i;
			switch (t) {
				case "style":
					a = Af(e);
					break;
				case "script": a = Pf(e);
			}
			mf.has(a) || (e = h({
				rel: "preload",
				href: t === "image" && n && n.imageSrcSet ? void 0 : e,
				as: t
			}, n), mf.set(a, e), r.querySelector(i) !== null || t === "style" && r.querySelector(jf(a)) || t === "script" && r.querySelector(Ff(a)) || (t = r.createElement("link"), $(t, "link", e), kt(t), r.head.appendChild(t)));
		}
	}
	function Tf(e, t) {
		_f.m(e, t);
		var n = bf;
		if (n && e) {
			var r = t && typeof t.as == "string" ? t.as : "script", i = "link[rel=\"modulepreload\"][as=\"" + Jt(r) + "\"][href=\"" + Jt(e) + "\"]", a = i;
			switch (r) {
				case "audioworklet":
				case "paintworklet":
				case "serviceworker":
				case "sharedworker":
				case "worker":
				case "script": a = Pf(e);
			}
			if (!mf.has(a) && (e = h({
				rel: "modulepreload",
				href: e
			}, t), mf.set(a, e), n.querySelector(i) === null)) {
				switch (r) {
					case "audioworklet":
					case "paintworklet":
					case "serviceworker":
					case "sharedworker":
					case "worker":
					case "script": if (n.querySelector(Ff(a))) return;
				}
				r = n.createElement("link"), $(r, "link", e), kt(r), n.head.appendChild(r);
			}
		}
	}
	function Ef(e, t, n) {
		_f.S(e, t, n);
		var r = bf;
		if (r && e) {
			var i = Ot(r).hoistableStyles, a = Af(e);
			t ||= "default";
			var o = i.get(a);
			if (!o) {
				var s = {
					loading: 0,
					preload: null
				};
				if (o = r.querySelector(jf(a))) s.loading = 5;
				else {
					e = h({
						rel: "stylesheet",
						href: e,
						"data-precedence": t
					}, n), (n = mf.get(a)) && Rf(e, n);
					var c = o = r.createElement("link");
					kt(c), $(c, "link", e), c._p = new Promise(function(e, t) {
						c.onload = e, c.onerror = t;
					}), c.addEventListener("load", function() {
						s.loading |= 1;
					}), c.addEventListener("error", function() {
						s.loading |= 2;
					}), s.loading |= 4, Lf(o, t, r);
				}
				o = {
					type: "stylesheet",
					instance: o,
					count: 1,
					state: s
				}, i.set(a, o);
			}
		}
	}
	function Df(e, t) {
		_f.X(e, t);
		var n = bf;
		if (n && e) {
			var r = Ot(n).hoistableScripts, i = Pf(e), a = r.get(i);
			a || (a = n.querySelector(Ff(i)), a || (e = h({
				src: e,
				async: !0
			}, t), (t = mf.get(i)) && zf(e, t), a = n.createElement("script"), kt(a), $(a, "link", e), n.head.appendChild(a)), a = {
				type: "script",
				instance: a,
				count: 1,
				state: null
			}, r.set(i, a));
		}
	}
	function Of(e, t) {
		_f.M(e, t);
		var n = bf;
		if (n && e) {
			var r = Ot(n).hoistableScripts, i = Pf(e), a = r.get(i);
			a || (a = n.querySelector(Ff(i)), a || (e = h({
				src: e,
				async: !0,
				type: "module"
			}, t), (t = mf.get(i)) && zf(e, t), a = n.createElement("script"), kt(a), $(a, "link", e), n.head.appendChild(a)), a = {
				type: "script",
				instance: a,
				count: 1,
				state: null
			}, r.set(i, a));
		}
	}
	function kf(e, t, n, r) {
		var i = (i = _e.current) ? gf(i) : null;
		if (!i) throw Error(s(446));
		switch (e) {
			case "meta":
			case "title": return null;
			case "style": return typeof n.precedence == "string" && typeof n.href == "string" ? (t = Af(n.href), n = Ot(i).hoistableStyles, r = n.get(t), r || (r = {
				type: "style",
				instance: null,
				count: 0,
				state: null
			}, n.set(t, r)), r) : {
				type: "void",
				instance: null,
				count: 0,
				state: null
			};
			case "link":
				if (n.rel === "stylesheet" && typeof n.href == "string" && typeof n.precedence == "string") {
					e = Af(n.href);
					var a = Ot(i).hoistableStyles, o = a.get(e);
					if (o || (i = i.ownerDocument || i, o = {
						type: "stylesheet",
						instance: null,
						count: 0,
						state: {
							loading: 0,
							preload: null
						}
					}, a.set(e, o), (a = i.querySelector(jf(e))) && !a._p && (o.instance = a, o.state.loading = 5), mf.has(e) || (n = {
						rel: "preload",
						as: "style",
						href: n.href,
						crossOrigin: n.crossOrigin,
						integrity: n.integrity,
						media: n.media,
						hrefLang: n.hrefLang,
						referrerPolicy: n.referrerPolicy
					}, mf.set(e, n), a || Nf(i, e, n, o.state))), t && r === null) throw Error(s(528, ""));
					return o;
				}
				if (t && r !== null) throw Error(s(529, ""));
				return null;
			case "script": return t = n.async, n = n.src, typeof n == "string" && t && typeof t != "function" && typeof t != "symbol" ? (t = Pf(n), n = Ot(i).hoistableScripts, r = n.get(t), r || (r = {
				type: "script",
				instance: null,
				count: 0,
				state: null
			}, n.set(t, r)), r) : {
				type: "void",
				instance: null,
				count: 0,
				state: null
			};
			default: throw Error(s(444, e));
		}
	}
	function Af(e) {
		return "href=\"" + Jt(e) + "\"";
	}
	function jf(e) {
		return "link[rel=\"stylesheet\"][" + e + "]";
	}
	function Mf(e) {
		return h({}, e, {
			"data-precedence": e.precedence,
			precedence: null
		});
	}
	function Nf(e, t, n, r) {
		e.querySelector("link[rel=\"preload\"][as=\"style\"][" + t + "]") ? r.loading = 1 : (t = e.createElement("link"), r.preload = t, t.addEventListener("load", function() {
			return r.loading |= 1;
		}), t.addEventListener("error", function() {
			return r.loading |= 2;
		}), $(t, "link", n), kt(t), e.head.appendChild(t));
	}
	function Pf(e) {
		return "[src=\"" + Jt(e) + "\"]";
	}
	function Ff(e) {
		return "script[async]" + e;
	}
	function If(e, t, n) {
		if (t.count++, t.instance === null) switch (t.type) {
			case "style":
				var r = e.querySelector("style[data-href~=\"" + Jt(n.href) + "\"]");
				if (r) return t.instance = r, kt(r), r;
				var i = h({}, n, {
					"data-href": n.href,
					"data-precedence": n.precedence,
					href: null,
					precedence: null
				});
				return r = (e.ownerDocument || e).createElement("style"), kt(r), $(r, "style", i), Lf(r, n.precedence, e), t.instance = r;
			case "stylesheet":
				i = Af(n.href);
				var a = e.querySelector(jf(i));
				if (a) return t.state.loading |= 4, t.instance = a, kt(a), a;
				r = Mf(n), (i = mf.get(i)) && Rf(r, i), a = (e.ownerDocument || e).createElement("link"), kt(a);
				var o = a;
				return o._p = new Promise(function(e, t) {
					o.onload = e, o.onerror = t;
				}), $(a, "link", r), t.state.loading |= 4, Lf(a, n.precedence, e), t.instance = a;
			case "script": return a = Pf(n.src), (i = e.querySelector(Ff(a))) ? (t.instance = i, kt(i), i) : (r = n, (i = mf.get(a)) && (r = h({}, n), zf(r, i)), e = e.ownerDocument || e, i = e.createElement("script"), kt(i), $(i, "link", r), e.head.appendChild(i), t.instance = i);
			case "void": return null;
			default: throw Error(s(443, t.type));
		}
		else t.type === "stylesheet" && !(t.state.loading & 4) && (r = t.instance, t.state.loading |= 4, Lf(r, n.precedence, e));
		return t.instance;
	}
	function Lf(e, t, n) {
		for (var r = n.querySelectorAll("link[rel=\"stylesheet\"][data-precedence],style[data-precedence]"), i = r.length ? r[r.length - 1] : null, a = i, o = 0; o < r.length; o++) {
			var s = r[o];
			if (s.dataset.precedence === t) a = s;
			else if (a !== i) break;
		}
		a ? a.parentNode.insertBefore(e, a.nextSibling) : (t = n.nodeType === 9 ? n.head : n, t.insertBefore(e, t.firstChild));
	}
	function Rf(e, t) {
		e.crossOrigin ??= t.crossOrigin, e.referrerPolicy ??= t.referrerPolicy, e.title ??= t.title;
	}
	function zf(e, t) {
		e.crossOrigin ??= t.crossOrigin, e.referrerPolicy ??= t.referrerPolicy, e.integrity ??= t.integrity;
	}
	var Bf = null;
	function Vf(e, t, n) {
		if (Bf === null) {
			var r = /* @__PURE__ */ new Map(), i = Bf = /* @__PURE__ */ new Map();
			i.set(n, r);
		} else i = Bf, r = i.get(n), r || (r = /* @__PURE__ */ new Map(), i.set(n, r));
		if (r.has(e)) return r;
		for (r.set(e, null), n = n.getElementsByTagName(e), i = 0; i < n.length; i++) {
			var a = n[i];
			if (!(a[Ct] || a[gt] || e === "link" && a.getAttribute("rel") === "stylesheet") && a.namespaceURI !== "http://www.w3.org/2000/svg") {
				var o = a.getAttribute(t) || "";
				o = e + o;
				var s = r.get(o);
				s ? s.push(a) : r.set(o, [a]);
			}
		}
		return r;
	}
	function Hf(e, t, n) {
		e = e.ownerDocument || e, e.head.insertBefore(n, t === "title" ? e.querySelector("head > title") : null);
	}
	function Uf(e, t, n) {
		if (n === 1 || t.itemProp != null) return !1;
		switch (e) {
			case "meta":
			case "title": return !0;
			case "style":
				if (typeof t.precedence != "string" || typeof t.href != "string" || t.href === "") break;
				return !0;
			case "link":
				if (typeof t.rel != "string" || typeof t.href != "string" || t.href === "" || t.onLoad || t.onError) break;
				switch (t.rel) {
					case "stylesheet": return e = t.disabled, typeof t.precedence == "string" && e == null;
					default: return !0;
				}
			case "script": if (t.async && typeof t.async != "function" && typeof t.async != "symbol" && !t.onLoad && !t.onError && t.src && typeof t.src == "string") return !0;
		}
		return !1;
	}
	function Wf(e) {
		return !(e.type === "stylesheet" && !(e.state.loading & 3));
	}
	function Gf(e, t, n, r) {
		if (n.type === "stylesheet" && (typeof r.media != "string" || !1 !== matchMedia(r.media).matches) && !(n.state.loading & 4)) {
			if (n.instance === null) {
				var i = Af(r.href), a = t.querySelector(jf(i));
				if (a) {
					t = a._p, typeof t == "object" && t && typeof t.then == "function" && (e.count++, e = Jf.bind(e), t.then(e, e)), n.state.loading |= 4, n.instance = a, kt(a);
					return;
				}
				a = t.ownerDocument || t, r = Mf(r), (i = mf.get(i)) && Rf(r, i), a = a.createElement("link"), kt(a);
				var o = a;
				o._p = new Promise(function(e, t) {
					o.onload = e, o.onerror = t;
				}), $(a, "link", r), n.instance = a;
			}
			e.stylesheets === null && (e.stylesheets = /* @__PURE__ */ new Map()), e.stylesheets.set(n, t), (t = n.state.preload) && !(n.state.loading & 3) && (e.count++, n = Jf.bind(e), t.addEventListener("load", n), t.addEventListener("error", n));
		}
	}
	var Kf = 0;
	function qf(e, t) {
		return e.stylesheets && e.count === 0 && Xf(e, e.stylesheets), 0 < e.count || 0 < e.imgCount ? function(n) {
			var r = setTimeout(function() {
				if (e.stylesheets && Xf(e, e.stylesheets), e.unsuspend) {
					var t = e.unsuspend;
					e.unsuspend = null, t();
				}
			}, 6e4 + t);
			0 < e.imgBytes && Kf === 0 && (Kf = 62500 * Ld());
			var i = setTimeout(function() {
				if (e.waitingForImages = !1, e.count === 0 && (e.stylesheets && Xf(e, e.stylesheets), e.unsuspend)) {
					var t = e.unsuspend;
					e.unsuspend = null, t();
				}
			}, (e.imgBytes > Kf ? 50 : 800) + t);
			return e.unsuspend = n, function() {
				e.unsuspend = null, clearTimeout(r), clearTimeout(i);
			};
		} : null;
	}
	function Jf() {
		if (this.count--, this.count === 0 && (this.imgCount === 0 || !this.waitingForImages)) {
			if (this.stylesheets) Xf(this, this.stylesheets);
			else if (this.unsuspend) {
				var e = this.unsuspend;
				this.unsuspend = null, e();
			}
		}
	}
	var Yf = null;
	function Xf(e, t) {
		e.stylesheets = null, e.unsuspend !== null && (e.count++, Yf = /* @__PURE__ */ new Map(), t.forEach(Zf, e), Yf = null, Jf.call(e));
	}
	function Zf(e, t) {
		if (!(t.state.loading & 4)) {
			var n = Yf.get(e);
			if (n) var r = n.get(null);
			else {
				n = /* @__PURE__ */ new Map(), Yf.set(e, n);
				for (var i = e.querySelectorAll("link[data-precedence],style[data-precedence]"), a = 0; a < i.length; a++) {
					var o = i[a];
					(o.nodeName === "LINK" || o.getAttribute("media") !== "not all") && (n.set(o.dataset.precedence, o), r = o);
				}
				r && n.set(null, r);
			}
			i = t.instance, o = i.getAttribute("data-precedence"), a = n.get(o) || r, a === r && n.set(null, i), n.set(o, i), this.count++, r = Jf.bind(this), i.addEventListener("load", r), i.addEventListener("error", r), a ? a.parentNode.insertBefore(i, a.nextSibling) : (e = e.nodeType === 9 ? e.head : e, e.insertBefore(i, e.firstChild)), t.state.loading |= 4;
		}
	}
	var Qf = {
		$$typeof: C,
		Provider: null,
		Consumer: null,
		_currentValue: ue,
		_currentValue2: ue,
		_threadCount: 0
	};
	function $f(e, t, n, r, i, a, o, s, c) {
		this.tag = 1, this.containerInfo = e, this.pingCache = this.current = this.pendingChildren = null, this.timeoutHandle = -1, this.callbackNode = this.next = this.pendingContext = this.context = this.cancelPendingCommit = null, this.callbackPriority = 0, this.expirationTimes = at(-1), this.entangledLanes = this.shellSuspendCounter = this.errorRecoveryDisabledLanes = this.expiredLanes = this.warmLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0, this.entanglements = at(0), this.hiddenUpdates = at(null), this.identifierPrefix = r, this.onUncaughtError = i, this.onCaughtError = a, this.onRecoverableError = o, this.pooledCache = null, this.pooledCacheLanes = 0, this.formState = c, this.incompleteTransitions = /* @__PURE__ */ new Map();
	}
	function ep(e, t, n, r, i, a, o, s, c, l, u, d) {
		return e = new $f(e, t, n, o, c, l, u, d, s), t = 1, !0 === a && (t |= 24), a = hi(3, null, null, t), e.current = a, a.stateNode = e, t = ha(), t.refCount++, e.pooledCache = t, t.refCount++, a.memoizedState = {
			element: r,
			isDehydrated: n,
			cache: t
		}, Ka(a), e;
	}
	function tp(e) {
		return e ? (e = pi, e) : pi;
	}
	function np(e, t, n, r, i, a) {
		i = tp(i), r.context === null ? r.context = i : r.pendingContext = i, r = Ja(t), r.payload = { element: n }, a = a === void 0 ? null : a, a !== null && (r.callback = a), n = Ya(e, r, t), n !== null && (gu(n, e, t), Xa(n, e, t));
	}
	function rp(e, t) {
		if (e = e.memoizedState, e !== null && e.dehydrated !== null) {
			var n = e.retryLane;
			e.retryLane = n !== 0 && n < t ? n : t;
		}
	}
	function ip(e, t) {
		rp(e, t), (e = e.alternate) && rp(e, t);
	}
	function ap(e) {
		if (e.tag === 13 || e.tag === 31) {
			var t = ui(e, 67108864);
			t !== null && gu(t, e, 67108864), ip(e, 67108864);
		}
	}
	function op(e) {
		if (e.tag === 13 || e.tag === 31) {
			var t = mu();
			t = dt(t);
			var n = ui(e, t);
			n !== null && gu(n, e, t), ip(e, t);
		}
	}
	var sp = !0;
	function cp(e, t, n, r) {
		var i = E.T;
		E.T = null;
		var a = D.p;
		try {
			D.p = 2, up(e, t, n, r);
		} finally {
			D.p = a, E.T = i;
		}
	}
	function lp(e, t, n, r) {
		var i = E.T;
		E.T = null;
		var a = D.p;
		try {
			D.p = 8, up(e, t, n, r);
		} finally {
			D.p = a, E.T = i;
		}
	}
	function up(e, t, n, r) {
		if (sp) {
			var i = dp(r);
			if (i === null) Td(e, t, r, fp, n), Cp(e, r);
			else if (Tp(i, e, t, n, r)) r.stopPropagation();
			else if (Cp(e, r), t & 4 && -1 < Sp.indexOf(e)) {
				for (; i !== null;) {
					var a = Et(i);
					if (a !== null) switch (a.tag) {
						case 3:
							if (a = a.stateNode, a.current.memoizedState.isDehydrated) {
								var o = et(a.pendingLanes);
								if (o !== 0) {
									var s = a;
									for (s.pendingLanes |= 2, s.entangledLanes |= 2; o;) {
										var c = 1 << 31 - qe(o);
										s.entanglements[1] |= c, o &= ~c;
									}
									id(a), !(G & 6) && (nu = Fe() + 500, ad(0, !1));
								}
							}
							break;
						case 31:
						case 13: s = ui(a, 2), s !== null && gu(s, a, 2), xu(), ip(a, 2);
					}
					if (a = dp(r), a === null && Td(e, t, r, fp, n), a === i) break;
					i = a;
				}
				i !== null && r.stopPropagation();
			} else Td(e, t, r, null, n);
		}
	}
	function dp(e) {
		return e = dn(e), pp(e);
	}
	var fp = null;
	function pp(e) {
		if (fp = null, e = Tt(e), e !== null) {
			var t = l(e);
			if (t === null) e = null;
			else {
				var n = t.tag;
				if (n === 13) {
					if (e = u(t), e !== null) return e;
					e = null;
				} else if (n === 31) {
					if (e = d(t), e !== null) return e;
					e = null;
				} else if (n === 3) {
					if (t.stateNode.current.memoizedState.isDehydrated) return t.tag === 3 ? t.stateNode.containerInfo : null;
					e = null;
				} else t !== e && (e = null);
			}
		}
		return fp = e, null;
	}
	function mp(e) {
		switch (e) {
			case "beforetoggle":
			case "cancel":
			case "click":
			case "close":
			case "contextmenu":
			case "copy":
			case "cut":
			case "auxclick":
			case "dblclick":
			case "dragend":
			case "dragstart":
			case "drop":
			case "focusin":
			case "focusout":
			case "input":
			case "invalid":
			case "keydown":
			case "keypress":
			case "keyup":
			case "mousedown":
			case "mouseup":
			case "paste":
			case "pause":
			case "play":
			case "pointercancel":
			case "pointerdown":
			case "pointerup":
			case "ratechange":
			case "reset":
			case "resize":
			case "seeked":
			case "submit":
			case "toggle":
			case "touchcancel":
			case "touchend":
			case "touchstart":
			case "volumechange":
			case "change":
			case "selectionchange":
			case "textInput":
			case "compositionstart":
			case "compositionend":
			case "compositionupdate":
			case "beforeblur":
			case "afterblur":
			case "beforeinput":
			case "blur":
			case "fullscreenchange":
			case "focus":
			case "hashchange":
			case "popstate":
			case "select":
			case "selectstart": return 2;
			case "drag":
			case "dragenter":
			case "dragexit":
			case "dragleave":
			case "dragover":
			case "mousemove":
			case "mouseout":
			case "mouseover":
			case "pointermove":
			case "pointerout":
			case "pointerover":
			case "scroll":
			case "touchmove":
			case "wheel":
			case "mouseenter":
			case "mouseleave":
			case "pointerenter":
			case "pointerleave": return 8;
			case "message": switch (Ie()) {
				case Le: return 2;
				case Re: return 8;
				case ze:
				case Be: return 32;
				case Ve: return 268435456;
				default: return 32;
			}
			default: return 32;
		}
	}
	var hp = !1, gp = null, _p = null, vp = null, yp = /* @__PURE__ */ new Map(), bp = /* @__PURE__ */ new Map(), xp = [], Sp = "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(" ");
	function Cp(e, t) {
		switch (e) {
			case "focusin":
			case "focusout":
				gp = null;
				break;
			case "dragenter":
			case "dragleave":
				_p = null;
				break;
			case "mouseover":
			case "mouseout":
				vp = null;
				break;
			case "pointerover":
			case "pointerout":
				yp.delete(t.pointerId);
				break;
			case "gotpointercapture":
			case "lostpointercapture": bp.delete(t.pointerId);
		}
	}
	function wp(e, t, n, r, i, a) {
		return e === null || e.nativeEvent !== a ? (e = {
			blockedOn: t,
			domEventName: n,
			eventSystemFlags: r,
			nativeEvent: a,
			targetContainers: [i]
		}, t !== null && (t = Et(t), t !== null && ap(t)), e) : (e.eventSystemFlags |= r, t = e.targetContainers, i !== null && t.indexOf(i) === -1 && t.push(i), e);
	}
	function Tp(e, t, n, r, i) {
		switch (t) {
			case "focusin": return gp = wp(gp, e, t, n, r, i), !0;
			case "dragenter": return _p = wp(_p, e, t, n, r, i), !0;
			case "mouseover": return vp = wp(vp, e, t, n, r, i), !0;
			case "pointerover":
				var a = i.pointerId;
				return yp.set(a, wp(yp.get(a) || null, e, t, n, r, i)), !0;
			case "gotpointercapture": return a = i.pointerId, bp.set(a, wp(bp.get(a) || null, e, t, n, r, i)), !0;
		}
		return !1;
	}
	function Ep(e) {
		var t = Tt(e.target);
		if (t !== null) {
			var n = l(t);
			if (n !== null) {
				if (t = n.tag, t === 13) {
					if (t = u(n), t !== null) {
						e.blockedOn = t, mt(e.priority, function() {
							op(n);
						});
						return;
					}
				} else if (t === 31) {
					if (t = d(n), t !== null) {
						e.blockedOn = t, mt(e.priority, function() {
							op(n);
						});
						return;
					}
				} else if (t === 3 && n.stateNode.current.memoizedState.isDehydrated) {
					e.blockedOn = n.tag === 3 ? n.stateNode.containerInfo : null;
					return;
				}
			}
		}
		e.blockedOn = null;
	}
	function Dp(e) {
		if (e.blockedOn !== null) return !1;
		for (var t = e.targetContainers; 0 < t.length;) {
			var n = dp(e.nativeEvent);
			if (n === null) {
				n = e.nativeEvent;
				var r = new n.constructor(n.type, n);
				k = r, n.target.dispatchEvent(r), k = null;
			} else return t = Et(n), t !== null && ap(t), e.blockedOn = n, !1;
			t.shift();
		}
		return !0;
	}
	function Op(e, t, n) {
		Dp(e) && n.delete(t);
	}
	function kp() {
		hp = !1, gp !== null && Dp(gp) && (gp = null), _p !== null && Dp(_p) && (_p = null), vp !== null && Dp(vp) && (vp = null), yp.forEach(Op), bp.forEach(Op);
	}
	function Ap(e, n) {
		e.blockedOn === n && (e.blockedOn = null, hp || (hp = !0, t.unstable_scheduleCallback(t.unstable_NormalPriority, kp)));
	}
	var jp = null;
	function Mp(e) {
		jp !== e && (jp = e, t.unstable_scheduleCallback(t.unstable_NormalPriority, function() {
			jp === e && (jp = null);
			for (var t = 0; t < e.length; t += 3) {
				var n = e[t], r = e[t + 1], i = e[t + 2];
				if (typeof r != "function") {
					if (pp(r || n) === null) continue;
					break;
				}
				var a = Et(n);
				a !== null && (e.splice(t, 3), t -= 3, Es(a, {
					pending: !0,
					data: i,
					method: n.method,
					action: r
				}, r, i));
			}
		}));
	}
	function Np(e) {
		function t(t) {
			return Ap(t, e);
		}
		gp !== null && Ap(gp, e), _p !== null && Ap(_p, e), vp !== null && Ap(vp, e), yp.forEach(t), bp.forEach(t);
		for (var n = 0; n < xp.length; n++) {
			var r = xp[n];
			r.blockedOn === e && (r.blockedOn = null);
		}
		for (; 0 < xp.length && (n = xp[0], n.blockedOn === null);) Ep(n), n.blockedOn === null && xp.shift();
		if (n = (e.ownerDocument || e).$$reactFormReplay, n != null) for (r = 0; r < n.length; r += 3) {
			var i = n[r], a = n[r + 1], o = i[_t] || null;
			if (typeof a == "function") o || Mp(n);
			else if (o) {
				var s = null;
				if (a && a.hasAttribute("formAction")) {
					if (i = a, o = a[_t] || null) s = o.formAction;
					else if (pp(i) !== null) continue;
				} else s = o.action;
				typeof s == "function" ? n[r + 1] = s : (n.splice(r, 3), r -= 3), Mp(n);
			}
		}
	}
	function Pp() {
		function e(e) {
			e.canIntercept && e.info === "react-transition" && e.intercept({
				handler: function() {
					return new Promise(function(e) {
						return i = e;
					});
				},
				focusReset: "manual",
				scroll: "manual"
			});
		}
		function t() {
			i !== null && (i(), i = null), r || setTimeout(n, 20);
		}
		function n() {
			if (!r && !navigation.transition) {
				var e = navigation.currentEntry;
				e && e.url != null && navigation.navigate(e.url, {
					state: e.getState(),
					info: "react-transition",
					history: "replace"
				});
			}
		}
		if (typeof navigation == "object") {
			var r = !1, i = null;
			return navigation.addEventListener("navigate", e), navigation.addEventListener("navigatesuccess", t), navigation.addEventListener("navigateerror", t), setTimeout(n, 100), function() {
				r = !0, navigation.removeEventListener("navigate", e), navigation.removeEventListener("navigatesuccess", t), navigation.removeEventListener("navigateerror", t), i !== null && (i(), i = null);
			};
		}
	}
	function Fp(e) {
		this._internalRoot = e;
	}
	Ip.prototype.render = Fp.prototype.render = function(e) {
		var t = this._internalRoot;
		if (t === null) throw Error(s(409));
		var n = t.current;
		np(n, mu(), e, t, null, null);
	}, Ip.prototype.unmount = Fp.prototype.unmount = function() {
		var e = this._internalRoot;
		if (e !== null) {
			this._internalRoot = null;
			var t = e.containerInfo;
			np(e.current, 2, null, e, null, null), xu(), t[vt] = null;
		}
	};
	function Ip(e) {
		this._internalRoot = e;
	}
	Ip.prototype.unstable_scheduleHydration = function(e) {
		if (e) {
			var t = pt();
			e = {
				blockedOn: null,
				target: e,
				priority: t
			};
			for (var n = 0; n < xp.length && t !== 0 && t < xp[n].priority; n++);
			xp.splice(n, 0, e), n === 0 && Ep(e);
		}
	};
	var Lp = r.version;
	if (Lp !== "19.2.8") throw Error(s(527, Lp, "19.2.8"));
	D.findDOMNode = function(e) {
		var t = e._reactInternals;
		if (t === void 0) throw typeof e.render == "function" ? Error(s(188)) : (e = Object.keys(e).join(","), Error(s(268, e)));
		return e = p(t), e = e === null ? null : m(e), e = e === null ? null : e.stateNode, e;
	};
	var Rp = {
		bundleType: 0,
		version: "19.2.8",
		rendererPackageName: "react-dom",
		currentDispatcherRef: E,
		reconcilerVersion: "19.2.8"
	};
	if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u") {
		var zp = __REACT_DEVTOOLS_GLOBAL_HOOK__;
		if (!zp.isDisabled && zp.supportsFiber) try {
			We = zp.inject(Rp), Ge = zp;
		} catch {}
	}
	e.createRoot = function(e, t) {
		if (!c(e)) throw Error(s(299));
		var n = !1, r = "", i = Ys, a = Xs, o = Zs;
		return t != null && (!0 === t.unstable_strictMode && (n = !0), t.identifierPrefix !== void 0 && (r = t.identifierPrefix), t.onUncaughtError !== void 0 && (i = t.onUncaughtError), t.onCaughtError !== void 0 && (a = t.onCaughtError), t.onRecoverableError !== void 0 && (o = t.onRecoverableError)), t = ep(e, 1, !1, null, null, n, r, null, i, a, o, Pp), e[vt] = t.current, Cd(e), new Fp(t);
	};
})), c = /* @__PURE__ */ e(((e, t) => {
	function n() {
		if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE == "function") try {
			__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n);
		} catch (e) {
			console.error(e);
		}
	}
	n(), t.exports = s();
})), l = (e) => e?.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/lucide-react@1.52.0_@types+react@19.2.18_react@19.2.8/node_modules/lucide-react/dist/esm/shared/src/utils/toLucideIconData.mjs
function u(e, t, n = []) {
	if (t == null) throw Error("[lucide]: iconNode is required when icon name is used");
	return {
		name: l(e),
		size: 24,
		node: t,
		...n.length > 0 ? { aliases: n } : {}
	};
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/lucide-react@1.52.0_@types+react@19.2.18_react@19.2.8/node_modules/lucide-react/dist/esm/shared/src/utils/toCamelCase.mjs
var d = (e) => {
	let t = "", n = !1;
	for (let r of e) {
		if (r === "-" || r === "_" || r <= " ") {
			n = t.length > 0;
			continue;
		}
		t.length === 0 ? t += r.toLowerCase() : t += n ? r.toUpperCase() : r, n = !1;
	}
	return t;
}, f = (e) => {
	let t = d(e);
	return t.charAt(0).toUpperCase() + t.slice(1);
}, p = (...e) => e.filter((e, t, n) => !!e && e.trim() !== "" && n.indexOf(e) === t).join(" ").trim(), m = {
	xmlns: "http://www.w3.org/2000/svg",
	width: 24,
	height: 24,
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	"stroke-width": 2,
	"stroke-linecap": "round",
	"stroke-linejoin": "round"
};
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/lucide-react@1.52.0_@types+react@19.2.18_react@19.2.8/node_modules/lucide-react/dist/esm/shared/src/build/buildLucideIconNode.mjs
function h(e) {
	return e != null;
}
function g(e, t = {}) {
	let n = t.attributeNames ?? {}, r = (e) => n[e] ?? e, i = e.size ?? e.width ?? m.width, a = e.size ?? e.height ?? m.height, o = e.aliases?.filter((e) => typeof e == "string" && e.trim() !== "").map((e) => `lucide-${e}`) ?? [], s = [...e.name ? [`lucide-${e.name}`] : [], ...o], c = t.className?.split(" ").filter(Boolean) ?? [], l = t.includeDefaultClasses === !1 ? p(...c) : p("lucide", ...s, ...c), u = t.absoluteStrokeWidth ? Number(t.strokeWidth ?? m["stroke-width"]) * Number(e.size ?? e.width ?? m.width) / Number(t.size ?? t.width ?? m.width) : t.strokeWidth ?? m["stroke-width"];
	return [
		"svg",
		{
			...Object.entries(m).reduce((e, [t, n]) => (e[r(t)] = n, e), {}),
			..."color" in t && t.color && { [r("stroke")]: t.color },
			..."size" in t && h(t.size) && {
				[r("width")]: t.size,
				[r("height")]: t.size
			},
			..."width" in t && h(t.width) && { [r("width")]: t.width },
			..."height" in t && h(t.height) && { [r("height")]: t.height },
			[r("stroke-width")]: u,
			...l && { [r("class")]: l },
			[r("viewBox")]: `0 0 ${i} ${a}`,
			...t.hasA11yProp === !1 ? { [r("aria-hidden")]: "true" } : {},
			..."attributes" in t && t.attributes
		},
		e.node.map((e) => {
			let [n, i, a] = e, o = t.nonScalingStroke ? {
				[r("vector-effect")]: "non-scaling-stroke",
				...i
			} : i;
			return a ? [
				n,
				o,
				a
			] : [n, o];
		})
	];
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/lucide-react@1.52.0_@types+react@19.2.18_react@19.2.8/node_modules/lucide-react/dist/esm/shared/src/build/buildLucideIconForReact.mjs
function _(e, t = {}) {
	return g(e, {
		...t,
		attributeNames: {
			...t.attributeNames,
			class: "className",
			"stroke-width": "strokeWidth",
			"stroke-linecap": "strokeLinecap",
			"stroke-linejoin": "strokeLinejoin",
			"vector-effect": "vectorEffect"
		}
	});
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/lucide-react@1.52.0_@types+react@19.2.18_react@19.2.8/node_modules/lucide-react/dist/esm/shared/src/utils/hasA11yProp.mjs
var v = (e) => {
	for (let t in e) if (t.startsWith("aria-") || t === "role" || t === "title") return !0;
	return !1;
}, y = n(), b = (0, y.createContext)({}), x = () => (0, y.useContext)(b), S = (0, y.forwardRef)(({ color: e, size: t, width: n, height: r, strokeWidth: i, absoluteStrokeWidth: a, nonScalingStroke: o, className: s = "", children: c, iconNode: l = [], icon: u = {
	node: l,
	aliases: [],
	size: 24
}, ...d }, f) => {
	let { size: m = 24, strokeWidth: h = 2, absoluteStrokeWidth: g = !1, nonScalingStroke: b = !1, color: S = "currentColor", className: C = "" } = x() ?? {}, w = !!c || v(d), [ee, te, ne = []] = _(u, {
		color: e ?? S,
		width: n ?? t ?? m,
		height: r ?? t ?? m,
		strokeWidth: i ?? h,
		absoluteStrokeWidth: a ?? g,
		nonScalingStroke: o ?? b,
		className: p(C, s),
		hasA11yProp: w,
		attributes: d
	});
	return (0, y.createElement)(ee, {
		ref: f,
		...te
	}, [...ne.map(([e, t]) => (0, y.createElement)(e, t)), ...Array.isArray(c) ? c : [c]]);
});
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/lucide-react@1.52.0_@types+react@19.2.18_react@19.2.8/node_modules/lucide-react/dist/esm/createLucideIcon.mjs
function C(e, t = [], n = []) {
	let r = typeof e == "string" ? u(e, t, n) : e, i = (0, y.forwardRef)(({ className: e, ...t }, n) => (0, y.createElement)(S, {
		ref: n,
		icon: r,
		className: e,
		...t
	}));
	return r.name && (i.displayName = f(r.name)), i;
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/lucide-react@1.52.0_@types+react@19.2.18_react@19.2.8/node_modules/lucide-react/dist/esm/icons/arrow-up.mjs
var w = {
	name: "arrow-up",
	size: 24,
	node: [["path", {
		d: "m5 12 7-7 7 7",
		key: "hav0vg"
	}], ["path", {
		d: "M12 19V5",
		key: "x0mq9r"
	}]]
};
w.node;
var ee = C(w), te = {
	name: "at-sign",
	size: 24,
	node: [["circle", {
		cx: "12",
		cy: "12",
		r: "4",
		key: "4exip2"
	}], ["path", {
		d: "M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8",
		key: "7n84p3"
	}]]
};
te.node;
var ne = C(te), re = {
	name: "x",
	size: 24,
	node: [["path", {
		d: "M18 6 6 18",
		key: "1bl5f8"
	}], ["path", {
		d: "m6 6 12 12",
		key: "d8bk6v"
	}]]
};
re.node;
var ie = C(re), ae = c(), oe = /* @__PURE__ */ (0, y.createContext)(null);
function se() {
	let e = (0, y.useContext)(oe);
	return e ?? function(e, ...t) {
		throw function(e, ...t) {
			let n = new URL("https://lexical.dev/docs/error"), r = new URLSearchParams();
			r.append("code", e);
			for (let e of t) r.append("v", e);
			return n.search = r.toString(), /* @__PURE__ */ Error(`Minified Lexical error #${e}; visit ${n.toString()} for the full message or use the non-minified dev environment for full errors and additional helpful warnings.`);
		}(e, ...t);
	}(8), e;
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/lexical@0.52.0_typescript@5.9.3/node_modules/lexical/dist/Lexical.prod.js
function ce(e, ...t) {
	let n = new URL("https://lexical.dev/docs/error"), r = new URLSearchParams();
	r.append("code", e);
	for (let e of t) r.append("v", e);
	return n.search = r.toString(), /* @__PURE__ */ Error(`Minified Lexical error #${e}; visit ${n.toString()} for the full message or use the non-minified dev environment for full errors and additional helpful warnings.`);
}
function T(e, ...t) {
	throw ce(e, ...t);
}
function le(e, ...t) {
	let n = new URL("https://lexical.dev/docs/error"), r = new URLSearchParams();
	r.append("code", e);
	for (let e of t) r.append("v", e);
	n.search = r.toString(), console.warn(`Minified Lexical warning #${e}; visit ${n.toString()} for the full message or use the non-minified dev environment for full errors and additional helpful warnings.`);
}
function E() {
	return typeof window < "u" && window.document !== void 0 && window.document.createElement !== void 0;
}
var D = /* @__PURE__ */ E();
function ue() {
	return D && "documentMode" in document ? document.documentMode : null;
}
var de = /* @__PURE__ */ ue();
function fe(e) {
	return D && e.test(navigator.platform);
}
function pe(e) {
	return D && e.test(navigator.userAgent);
}
var me = /* @__PURE__ */ fe(/Mac|iPod|iPhone|iPad/), O = /* @__PURE__ */ pe(/^(?!.*Seamonkey)(?=.*Firefox).*/i);
function he() {
	return !(!D || !("InputEvent" in window) || de) && "getTargetRanges" in new window.InputEvent("input");
}
var ge = /* @__PURE__ */ he();
function _e() {
	return D && !window.MSStream && (/iPad|iPhone|iPod/.test(navigator.userAgent) || /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}
var ve = /* @__PURE__ */ _e(), ye = /* @__PURE__ */ pe(/Android/), be = /* @__PURE__ */ pe(/Version\/[\d.]+.*Safari/) && !ye, xe = /* @__PURE__ */ pe(/^(?=.*Chrome).*/i), Se = D && ye && xe, Ce = /* @__PURE__ */ pe(/AppleWebKit\/[\d.]+/) && me && !xe;
function we() {
	return 2047;
}
var Te = /* @__PURE__ */ we(), Ee = be || ve || Ce ? "\xA0" : "​", De = "\n\n", Oe = O ? "\xA0" : Ee, ke = {
	bold: 1,
	capitalize: 1024,
	code: 16,
	highlight: 128,
	italic: 2,
	lowercase: 256,
	strikethrough: 4,
	subscript: 32,
	superscript: 64,
	underline: 8,
	uppercase: 512
}, Ae = {
	directionless: 1,
	unmergeable: 2
}, je = {
	center: 2,
	end: 6,
	justify: 4,
	left: 1,
	right: 3,
	start: 5
};
function Me(e) {
	let t = {};
	for (let n of Object.keys(e)) t[e[n]] = n;
	return t;
}
var Ne = /* @__PURE__ */ Me(je), Pe = {
	normal: 0,
	segmented: 2,
	token: 1
}, Fe = /* @__PURE__ */ Me(Pe), Ie = Symbol.for("@lexical/ctrlOrOtherKey"), Le = "$config";
function Re() {
	return J()._blockCursorElement;
}
function ze(e) {
	return e !== null && e.nodeType === 1 && e.hasAttribute("data-lexical-slot");
}
var Be = Ce || ve || be;
function Ve() {
	let e = El().createElement("img");
	e.setAttribute("data-lexical-decorator-boundary", "true"), e.alt = "";
	for (let [t, n] of [
		["position", "absolute"],
		["width", "0px"],
		["height", "0px"],
		["border", "0px"],
		["margin", "0px"],
		["padding", "0px"]
	]) e.style.setProperty(t, n, "important");
	return e;
}
function He(e) {
	return e !== null && e.nodeType === 1 && e.hasAttribute("data-lexical-decorator-boundary");
}
var Ue = class e {
	element;
	before;
	after;
	constructor(e, t, n) {
		this.element = e, this.before = t || null, this.after = n || null;
	}
	withBefore(t) {
		return new e(this.element, t, this.after);
	}
	withAfter(t) {
		return new e(this.element, this.before, t);
	}
	withElement(t) {
		return this.element === t ? this : new e(t, this.before, this.after);
	}
	insertChild(e) {
		let t = this.getInsertionAnchor();
		return t !== null && t.parentElement !== this.element && T(357), this.element.insertBefore(e, t), this;
	}
	removeChild(e) {
		return e.parentElement !== this.element && T(358), this.element.removeChild(e), this;
	}
	replaceChild(e, t) {
		return t.parentElement !== this.element && T(359), this.element.replaceChild(e, t), this;
	}
	getFirstChild() {
		let e = this.getFirstChildAnchor(), t = e ? e.nextSibling : this.element.firstChild;
		return t === this.getInsertionAnchor() ? null : t;
	}
	getFirstChildAnchor() {
		return this.after;
	}
	resolveLeafPosition(e, t, n) {
		if (this.element === e) return t === e && n === 0 ? "before" : "after";
		let r = We(e, this.element);
		if (r === null) return "after";
		let i = Array.prototype.indexOf.call(e.childNodes, r);
		if (i < 0) return "after";
		if (t === e) return n <= i ? "before" : "after";
		let a = We(e, t);
		if (a === null) return "after";
		let o = Array.prototype.indexOf.call(e.childNodes, a);
		return o >= 0 && o <= i ? "before" : "after";
	}
	getInsertionAnchor() {
		return this.before;
	}
};
function We(e, t) {
	let n = t;
	for (; n !== null && n.parentNode !== e;) n = n.parentNode;
	return n;
}
var Ge = class e extends Ue {
	withBefore(t) {
		return new e(this.element, t, this.after);
	}
	withAfter(t) {
		return new e(this.element, this.before, t);
	}
	withElement(t) {
		return this.element === t ? this : new e(t, this.before, this.after);
	}
	getInsertionAnchor() {
		return super.getInsertionAnchor() || this.getManagedLineBreak() || this.getDecoratorBoundaryAnchor("trailing");
	}
	getFirstChildAnchor() {
		let e = super.getFirstChildAnchor(), t = e ? e.nextSibling : this.element.firstChild;
		for (; ze(t);) e = t, t = t.nextSibling;
		He(t) && (e = t, t = t.nextSibling);
		let n = e ? e.nextSibling : this.element.firstChild;
		return n !== null && n === Re() ? n : e;
	}
	getDecoratorBoundaryAnchor(e) {
		let t;
		if (e === "leading") {
			let e = super.getFirstChildAnchor();
			for (t = e ? e.nextSibling : this.element.firstChild; ze(t);) t = t.nextSibling;
		} else t = this.before ? this.before.previousSibling : this.element.lastChild, t !== null && t === Re() && (t = t.previousSibling);
		return He(t) ? t : null;
	}
	setDecoratorBoundaryAnchor(e, t) {
		let n = this.getDecoratorBoundaryAnchor(e);
		if (t !== (n !== null)) {
			if (n !== null) this.element.removeChild(n);
			else if (e === "leading") {
				let e = this.getFirstChildAnchor();
				this.element.insertBefore(Ve(), e ? e.nextSibling : this.element.firstChild);
			} else this.element.insertBefore(Ve(), this.before);
		}
	}
	getManagedLineBreak() {
		return this.element.__lexicalLineBreak || null;
	}
	setManagedLineBreak(e) {
		let t = this.element, n = this.after === null ? t.firstChild : this.after.nextSibling, r = e === "empty" && ze(n) ? null : e;
		if (t.__lexicalLastChildKind !== r) {
			if (t.__lexicalLastChildKind = r, r === null) this.removeManagedLineBreak();
			else {
				let e = r === "decorator" && Be;
				this.insertManagedLineBreak(e);
			}
		}
	}
	removeManagedLineBreak() {
		let e = this.getManagedLineBreak();
		if (e) {
			let t = this.element, n = e.nodeName === "IMG" ? e.nextSibling : null;
			n && t.removeChild(n), t.removeChild(e), t.__lexicalLineBreak = void 0;
		}
	}
	insertManagedLineBreak(e) {
		let t = this.getManagedLineBreak();
		if (t) {
			if (e === (t.nodeName === "IMG")) return;
			this.removeManagedLineBreak();
		}
		let n = this.element, r = this.before || this.getDecoratorBoundaryAnchor("trailing"), i = El().createElement("br");
		if (i.setAttribute("data-lexical-managed-linebreak", "true"), n.insertBefore(i, r), e) {
			let e = El().createElement("img");
			e.setAttribute("data-lexical-managed-linebreak", "true"), e.style.setProperty("display", "inline", "important"), e.style.setProperty("border", "0px", "important"), e.style.setProperty("margin", "0px", "important"), e.alt = "", n.insertBefore(e, i), n.__lexicalLineBreak = e;
		} else n.__lexicalLineBreak = i;
	}
	getFirstChildOffset() {
		let e = this.getFirstChild(), t = this.getInsertionAnchor(), n = 0;
		for (let r = this.element.firstChild; r !== null && r !== e && r !== t; r = r.nextSibling) n++;
		return n;
	}
	resolveChildIndex(e, t, n, r) {
		if (n === this.element) {
			let t = this.getFirstChildOffset(), n = Re(), i = this.element.childNodes, a = Math.min(r, i.length), o = 0;
			for (let e = t; e < a; e++) i[e] !== n && o++;
			return [e, Math.min(o, e.getChildrenSize())];
		}
		let i = Ke(t, n);
		i.push(r);
		let a = Ke(t, this.element), o = e.getIndexWithinParent();
		for (let e = 0; e < a.length; e++) {
			let t = i[e], n = a[e];
			if (t === void 0 || t < n) break;
			if (t > n) {
				o += 1;
				break;
			}
		}
		return [e.getParentOrThrow(), o];
	}
};
function Ke(e, t) {
	let n = [], r = t;
	for (; r !== e && r !== null; r = r.parentNode) {
		let e = 0;
		for (let t = r.previousSibling; t !== null; t = t.previousSibling) e++;
		n.push(e);
	}
	return r !== e && T(225), n.reverse();
}
function qe() {
	let e;
	try {
		e = "0.52.0+prod.esm";
	} catch {}
	return e ?? "\"<unknown>+source\"";
}
var Je = /* @__PURE__ */ qe(), Ye = class {
	_front = /* @__PURE__ */ new Set();
	_back = /* @__PURE__ */ new Set();
	_cache;
	get size() {
		return this._front.size + this._back.size;
	}
	addBack(e) {
		return delete this._cache, this._front.has(e) || this._back.add(e), this;
	}
	addFront(e) {
		return delete this._cache, this._back.has(e) || this._front.add(e), this;
	}
	delete(e) {
		return delete this._cache, this._front.delete(e) || this._back.delete(e);
	}
	toArray() {
		let e = Array.from(this._front).reverse();
		for (let t of this._back) e.push(t);
		return e;
	}
	toReadonlyArray() {
		return this._cache = this._cache || this.toArray(), this._cache;
	}
	[Symbol.iterator]() {
		return this.toReadonlyArray()[Symbol.iterator]();
	}
}, Xe = null;
function Ze(e, t = 1e3) {
	return e instanceof Qe ? e.clone() : e.size < t ? new Map(e) : new Qe().init(new Map(e), void 0, e.size);
}
var Qe = class e {
	_mutable = !1;
	_old = void 0;
	_nursery = void 0;
	_size = 0;
	clone() {
		return this._mutable = !1, new e().init(this._old, this._nursery, this._size);
	}
	init(e, t, n) {
		return this._old = e, this._nursery = t, this._size = n, this;
	}
	get size() {
		return this._size;
	}
	has(e) {
		return this.get(e) !== void 0;
	}
	getWithTombstone(e) {
		let t = this._nursery && this._nursery.get(e);
		return t === void 0 ? this._old && this._old.get(e) : t;
	}
	get(e) {
		let t = this.getWithTombstone(e);
		return t === Xe ? void 0 : t;
	}
	shouldCompact() {
		return this._nursery !== void 0 && 2 * this._nursery.size > this._size;
	}
	getNursery() {
		return this._mutable && this._nursery || (this.compact(), this._nursery = new Map(this._nursery), this._mutable = !0), this._nursery;
	}
	compact(e = !1) {
		if (this._nursery && this._nursery.size > 0 && (e || this.shouldCompact())) {
			let e = new Map(this._old);
			for (let [t, n] of this._nursery) n === Xe ? e.delete(t) : e.set(t, n);
			this._old = e, this._nursery = void 0;
		}
		return this._mutable = !1, this;
	}
	set(e, t) {
		let n = this.getWithTombstone(e);
		if (n === t) return this;
		let r = this.getNursery();
		return n !== Xe && n !== void 0 || (this._size++, n === Xe && r.delete(e)), r.set(e, t), this;
	}
	delete(e) {
		let t = this.has(e);
		return t && (this.getNursery().set(e, Xe), this._size--), t;
	}
	getOrInsert(e, t) {
		let n = this.get(e);
		return n === void 0 ? (this.set(e, t), t) : n;
	}
	getOrInsertComputed(e, t) {
		let n = this.get(e);
		if (n !== void 0) return n;
		let r = t(e);
		return this.set(e, r), r;
	}
	clear() {
		this._mutable = !1, this._old = void 0, this._nursery = void 0, this._size = 0;
	}
	*keys() {
		for (let e of this.entries()) yield e[0];
	}
	*values() {
		for (let e of this.entries()) yield e[1];
	}
	*entries() {
		let e = this._nursery, t = this._old;
		if (e) {
			if (t) for (let n of t) {
				let t = n[0], r = e.get(t);
				r !== Xe && (r !== void 0 && (n[1] = r), yield n);
			}
			for (let n of e) n[1] === Xe || t && t.has(n[0]) || (yield n);
		} else t && (yield* t);
	}
	forEach(e, t) {
		t !== void 0 && (e = e.bind(t));
		for (let [t, n] of this.entries()) e(n, t, this);
	}
	get [Symbol.toStringTag]() {
		return "GenMap";
	}
	[Symbol.iterator]() {
		return this.entries();
	}
}, $e = !1;
function et(e, t, ...n) {
	let r = $e, i;
	try {
		$e = e, i = t();
	} finally {
		$e = r;
	}
	var a;
	return (a = i) === null || typeof a != "object" && typeof a != "function" || typeof a.then != "function" || T(421), i;
}
function tt() {
	return $e;
}
function nt(e) {
	let t = e.exportJSON($e), n = e.constructor;
	return t.type !== n.getType() && T(130, n.name), B(e) && !Array.isArray(t.children) && T(59, n.name), t;
}
function rt(e, t, n, r, i, a) {
	if (B(e)) {
		let o = e.getFirstChild();
		for (; o !== null;) {
			let e = o.__key;
			o.__parent === t && ((B(o) || Mu(o) && o.__slots !== null) && rt(o, e, n, r, i, a), n.has(e) || a.delete(e), i.push(e)), o = o.getNextSibling();
		}
	}
	for (let o of Mu(e) && e.__slots !== null ? e.__slots.values() : []) {
		let e = r.get(o);
		e !== void 0 && Nu(e) && e.__slotHost === t && ((B(e) || Mu(e) && e.__slots !== null) && rt(e, o, n, r, i, a), n.has(o) || a.delete(o), i.push(o));
	}
}
var it = !1, at = 0;
function ot(e) {
	at = e.timeStamp;
}
function st(e, t, n) {
	let r = e.nodeName === "BR", i = t.__lexicalLineBreak;
	return i && (e === i || r && e.previousSibling === i) || r && Oc(e, n) !== void 0;
}
function ct(e, t, n) {
	let r = yl(cl(n)), i = r && kl(r, n._rootElement), a = null, o = null;
	i !== null && i.anchorNode === e && (a = i.anchorOffset, o = i.focusOffset);
	let s = e.nodeValue;
	s !== null && Hc(t, s, a, o, !1);
}
function lt(e, t, n) {
	if (P(e)) {
		let t = e.anchor.getNode();
		if (t.is(n) && e.format !== t.getFormat()) return !1;
	}
	return _c(t) && n.isAttached();
}
function ut(e, t, n) {
	for (let r = e; r && !Ql(r); r = el(r)) {
		let e = Oc(r, t);
		if (e !== void 0) {
			let t = H(e, n);
			if (t) return V(t) || !W(r) ? void 0 : [r, t];
		}
	}
}
function dt(e, t, n) {
	it = !0;
	let r = performance.now() - at > 100;
	try {
		ns(e, () => {
			let i = F() || function(e) {
				return e.read("latest", () => {
					let e = F();
					return e === null ? null : e.clone();
				});
			}(e), a = /* @__PURE__ */ new Map(), o = e._editorState, s = e._blockCursorElement, c = !1, l = "";
			for (let n = 0; n < t.length; n++) {
				let u = t[n], d = u.type, f = u.target, p = ut(f, e, o);
				if (!p) continue;
				let [m, h] = p;
				if (d === "characterData") r && N(h) && _c(f) && lt(i, f, h) && ct(f, h, e);
				else if (d === "childList") {
					c = !0;
					let t = u.addedNodes;
					for (let n = 0; n < t.length; n++) {
						let r = t[n], i = Ec(r), a = r.parentNode;
						if (!(a == null || r === s || i !== null || st(r, a, e) || He(r) || e._slotsUsed && W(r) && r.hasAttribute("data-lexical-slot") || Ql(r))) {
							if (O) {
								let e = (W(r) ? r.innerText : null) || r.nodeValue;
								e && (l += e);
							}
							a.removeChild(r);
						}
					}
					let n = u.removedNodes, r = n.length;
					if (r > 0) {
						let t = 0;
						for (let i = 0; i < r; i++) {
							let r = n[i];
							st(r, f, e) || s === r ? (f.appendChild(r), t++) : He(r) && t++;
						}
						r !== t && a.set(m, h);
					}
				}
			}
			if (a.size > 0) for (let [t, n] of a) n.reconcileObservedMutation(t, e);
			let u = n.takeRecords();
			if (u.length > 0) {
				for (let t = 0; t < u.length; t++) {
					let n = u[t], r = n.addedNodes, i = n.target;
					for (let t = 0; t < r.length; t++) {
						let n = r[t], a = n.parentNode;
						a == null || n.nodeName !== "BR" || st(n, i, e) || a.removeChild(n);
					}
				}
				n.takeRecords();
			}
			i !== null && (c && Pc(i), O && Qc(e) && i.insertRawText(l));
		});
	} finally {
		it = !1;
	}
}
function ft(e) {
	let t = e._observer;
	t !== null && dt(e, t.takeRecords(), t);
}
function pt(e) {
	(function(e) {
		at === 0 && cl(e).addEventListener("textInput", ot, !0);
	})(e), e._observer = new MutationObserver((t, n) => {
		dt(e, t, n);
	});
}
function mt(e, t, n) {
	let { isEqual: r } = e;
	return t === n || r !== void 0 && r(t, n);
}
function ht(e, t) {
	return mt(e, t, e.defaultValue);
}
function gt(e) {
	return typeof e == "object" && !!e;
}
function _t(e, t) {
	let n = St(e, t).getter;
	return gt(n) && n.getterTable !== void 0 || T(405, t), xt(n.getterTable);
}
function vt(e, t) {
	let n = St(e, t).setter;
	return gt(n) && n.setterTable !== void 0 || T(406, t), xt(n.setterTable);
}
function yt(e, t, n) {
	let { meta: r } = St(e, t);
	for (let e = 0;;) if (r.kind === "aliased") {
		if (e === n) return xt(r.aliases);
		e++, r = r.inner.meta;
	} else r.kind === "nullable" || r.kind === "optional" ? r = r.inner.meta : r.kind === "array" ? r = r.item.meta : T(407, t, String(n));
}
function bt(e, t) {
	let n = St(e, t), { setter: r } = n;
	gt(r) && r.setterTable !== void 0 || T(408, t);
	let i = String(n.defaultValue);
	return kt(r.setterTable, i) || T(409, t, i), r.setterTable[i];
}
function xt(e) {
	return Object.assign(Object.create(null), e);
}
function St(e, t) {
	let n = e.get(t);
	return n === void 0 && T(410, t), n;
}
function Ct(e, t, n, r, i) {
	i !== void 0 && wt.add(i);
	let a = n === void 0, o = a ? e(void 0) : n;
	return a && Dt(o), Object.assign(e, {
		accepts: i,
		defaultValue: o,
		isEqual: r,
		meta: t
	});
}
var wt = /* @__PURE__ */ new WeakSet(), Tt = /* @__PURE__ */ new WeakSet();
function Et(e) {
	return typeof e == "object" && e && Tt.add(e), e;
}
function Dt(e) {
	if (typeof e == "object" && e && !Object.isFrozen(e) && !Tt.has(e)) {
		Object.freeze(e);
		for (let t of Object.values(e)) Dt(t);
	}
}
function Ot(e, t) {
	let { accepts: n } = e;
	return n === void 0 ? function(e, t) {
		let { accepts: n } = e;
		if (n !== void 0) return Ot(e, t) ? { parsed: e(t) } : void 0;
		let r = e(t);
		return ht(e, r) && t !== e.defaultValue ? void 0 : { parsed: r };
	}(e, t) !== void 0 : n.call(e, t);
}
function kt(e, t) {
	return Object.prototype.hasOwnProperty.call(e, t);
}
function At(e = "") {
	return Ct((t) => typeof t == "string" ? t : e, { kind: "string" }, void 0, void 0, (e) => typeof e == "string");
}
var jt = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
function Mt(e = 0, t = {}) {
	let { integer: n, clamp: r } = t, i = n && t.min !== void 0 ? Math.ceil(t.min) : t.min, a = n && t.max !== void 0 ? Math.floor(t.max) : t.max, o = (e) => typeof e == "string" && jt.test(e) ? Number(e) : e, s = (e) => typeof e == "number" && Number.isFinite(e) && (!n || Number.isInteger(e)), c = (e) => s(e) && (i === void 0 || e >= i) && (a === void 0 || e <= a);
	return Ct((t) => {
		let n = o(t);
		return r && s(n) ? i !== void 0 && n < i ? i : a !== void 0 && n > a ? a : n : c(n) ? n : e;
	}, {
		clamp: r,
		integer: n,
		kind: "number",
		max: a,
		min: i
	}, void 0, void 0, (e) => r ? s(o(e)) : c(o(e)));
}
function Nt(e, ...t) {
	let n = Et(t.length === 0 ? e[0] : t[0]), r = new Set(e);
	return Ct((e) => e !== void 0 && r.has(e) ? e : n, {
		kind: "enum",
		values: e
	}, n, void 0, (e) => r.has(e) && (e !== void 0 || n === void 0));
}
function Pt() {
	return (e) => function(e) {
		return { meta: {
			fields: e,
			kind: "node"
		} };
	}(e);
}
function Ft(e, t) {
	let n = (e) => typeof e == "string" && kt(t, e);
	return Ct((r) => n(r) ? t[r] : e(r), {
		aliases: t,
		inner: e,
		kind: "aliased"
	}, e.defaultValue, e.isEqual, (t) => n(t) || Ot(e, t));
}
function It(e, t) {
	return Rt(0, e, {
		getter: {
			field: t.field,
			getterTable: t.getterTable,
			method: t.getter,
			when: t.when
		},
		setter: {
			field: t.field,
			method: t.setter,
			setterTable: t.setterTable
		}
	});
}
function Lt(e, t) {
	return Rt(0, e, t);
}
function Rt(e, t, n) {
	return Object.assign((e) => t(e), {
		accepts: t.accepts,
		defaultValue: t.defaultValue,
		getter: n.getter,
		isEqual: t.isEqual,
		meta: t.meta,
		setter: n.setter
	});
}
var zt = "latest", Bt = class {
	key;
	parse;
	unparse;
	isEqual;
	defaultValue;
	resetOnCopyNode;
	schema;
	constructor(e, t) {
		this.key = e;
		let n = "meta" in (r = t.parse) && typeof r.meta == "object" && r.meta !== null && "kind" in r.meta && typeof r.meta.kind == "string" && "defaultValue" in r ? t.parse : void 0;
		var r;
		this.schema = n, this.parse = t.parse.bind(t), this.unparse = (t.unparse || Xt).bind(t), this.isEqual = t.isEqual ? t.isEqual.bind(t) : n !== void 0 && n.isEqual !== void 0 ? (e, t) => mt(n, e, t) : Object.is, this.defaultValue = n === void 0 ? this.parse(void 0) : n.defaultValue, this.resetOnCopyNode = t.resetOnCopyNode || !1;
	}
};
function Vt(e, t) {
	return new Bt(e, t);
}
function Ht(e, t, n = zt) {
	let r = (n === "latest" ? e.getLatest() : e).__state;
	return r ? r.getValue(t) : t.defaultValue;
}
function Ut(e, t, n) {
	let r;
	if (Lo(), typeof n == "function") {
		let i = e.getLatest(), a = Ht(i, t);
		if (r = n(a), t.isEqual(a, r)) return i;
	} else r = n;
	let i = e.getWritable();
	return qt(i).updateFromKnown(t, r), i;
}
function Wt(e) {
	let t = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Set();
	for (let { ownNodeConfig: r } of Eu(typeof e == "function" ? e : e.replace)) if (r && r.stateConfigs) for (let e of r.stateConfigs) {
		let r;
		"stateConfig" in e ? (r = e.stateConfig, e.flat && n.add(r.key)) : r = e, t.set(r.key, r);
	}
	return {
		flatKeys: n,
		sharedConfigMap: t
	};
}
var Gt = /* @__PURE__ */ new Set([
	"__proto__",
	"constructor",
	"prototype"
]), Kt = class e {
	node;
	knownState;
	unknownState;
	sharedNodeState;
	size;
	constructor(e, t, n = void 0, r = /* @__PURE__ */ new Map(), i = void 0) {
		this.node = e, this.sharedNodeState = t, this.unknownState = n, this.knownState = r;
		let { sharedConfigMap: a } = this.sharedNodeState, o = i === void 0 ? function(e, t, n) {
			let r = n.size;
			if (t) for (let i in t) {
				let t = e.get(i);
				t && n.has(t) || r++;
			}
			return r;
		}(a, n, r) : i;
		this.size = o;
	}
	getValue(e) {
		let t = this.knownState.get(e);
		if (t !== void 0) return t;
		this.sharedNodeState.sharedConfigMap.set(e.key, e);
		let n = e.defaultValue;
		if (this.unknownState && e.key in this.unknownState) {
			let t = this.unknownState[e.key];
			t !== void 0 && (n = e.parse(t)), this.updateFromKnown(e, n);
		}
		return n;
	}
	getInternalState() {
		return [this.unknownState, this.knownState];
	}
	toJSON() {
		let e = { ...this.unknownState }, t = {};
		for (let [t, n] of this.knownState) t.isEqual(n, t.defaultValue) ? delete e[t.key] : e[t.key] = t.unparse(n);
		for (let n of this.sharedNodeState.flatKeys) n in e && (t[n] = e[n], delete e[n]);
		return Yt(e) && (t.$ = e), t;
	}
	getWritable(t) {
		if (this.node === t) return this;
		let { sharedNodeState: n, unknownState: r } = this, i = new Map(this.knownState);
		return new e(t, n, function(e, t, n) {
			let r;
			if (n) for (let [i, a] of Object.entries(n)) {
				if (Gt.has(i)) continue;
				let n = e.get(i);
				n ? t.has(n) || t.set(n, n.parse(a)) : (r ||= {}, r[i] = a);
			}
			return r;
		}(n.sharedConfigMap, i, r), i, this.size);
	}
	resetOnCopyNode() {
		for (let e of this.knownState.keys()) e.resetOnCopyNode && this.knownState.set(e, e.defaultValue);
		return this;
	}
	updateFromKnown(e, t) {
		let n = e.key;
		this.sharedNodeState.sharedConfigMap.set(n, e);
		let { knownState: r, unknownState: i } = this;
		r.has(e) || i && n in i || (i && (delete i[n], this.unknownState = Yt(i)), this.size++), r.set(e, t);
	}
	updateFromUnknown(e, t) {
		if (Gt.has(e)) return;
		let n = this.sharedNodeState.sharedConfigMap.get(e);
		n ? this.updateFromKnown(n, n.parse(t)) : (this.unknownState = this.unknownState || {}, e in this.unknownState || this.size++, this.unknownState[e] = t);
	}
	updateFromJSON(e) {
		let { knownState: t } = this;
		for (let e of t.keys()) t.set(e, e.defaultValue);
		if (this.size = t.size, this.unknownState = void 0, e) for (let [t, n] of Object.entries(e)) this.updateFromUnknown(t, n);
	}
};
function qt(e) {
	let t = e.getWritable(), n = t.__state ? t.__state.getWritable(t) : new Kt(t, function(e) {
		return e.__state ? e.__state.sharedNodeState : sc(J(), e.getType()).sharedNodeState;
	}(t));
	return t.__state = n, n;
}
function Jt(e, t) {
	let n = e.getWritable(), r = t.$;
	return (n.__state || r) && qt(e).updateFromJSON(r), n;
}
function Yt(e) {
	if (e) for (let t in e) return e;
}
function Xt(e) {
	return e;
}
function Zt(e, t, n) {
	for (let [r, i] of t.knownState) {
		if (e.has(r.key)) continue;
		e.add(r.key);
		let t = n ? n.getValue(r) : r.defaultValue;
		if (t !== i && !r.isEqual(t, i)) return !0;
	}
	return !1;
}
function Qt(e, t, n) {
	let { unknownState: r } = t, i = n ? n.unknownState : void 0;
	if (r) {
		for (let [t, n] of Object.entries(r)) if (!e.has(t) && (e.add(t), n !== (i ? i[t] : void 0))) return !0;
	}
	return !1;
}
function $t(e, t) {
	let n = e.__state;
	return n && n.node === e ? n.getWritable(t) : n;
}
function en(e, t) {
	let n = e.__mode, r = e.__format, i = e.__style, a = t.__mode, o = t.__format, s = t.__style, c = e.__state, l = t.__state;
	return (n === null || n === a) && (r === null || r === o) && (i === null || i === s) && (e.__state === null || c === l || function(e, t) {
		if (e === t) return !0;
		let n = /* @__PURE__ */ new Set();
		return !(e && Zt(n, e, t) || t && Zt(n, t, e) || e && Qt(n, e, t) || t && Qt(n, t, e));
	}(c, l));
}
function tn(e, t) {
	let n = e.mergeWithSibling(t), r = z()._normalizedNodes;
	return r.add(e.__key), r.add(t.__key), n;
}
function nn(e) {
	let t, n, r = e;
	if (r.__text !== "" || !r.isSimpleText() || r.isUnmergeable()) {
		for (; (t = r.getPreviousSibling()) !== null && N(t) && t.isSimpleText() && !t.isUnmergeable();) {
			if (t.__text !== "") {
				if (en(t, r)) {
					r = tn(t, r);
					break;
				}
				break;
			}
			t.remove();
		}
		for (; (n = r.getNextSibling()) !== null && N(n) && n.isSimpleText() && !n.isUnmergeable();) {
			if (n.__text !== "") {
				if (en(r, n)) {
					r = tn(r, n);
					break;
				}
				break;
			}
			n.remove();
		}
	} else r.remove();
}
function rn(e) {
	return an(e.anchor), an(e.focus), e;
}
function an(e) {
	for (; e.type === "element";) {
		let t = e.getNode(), n = e.offset, r, i;
		if (n === t.getChildrenSize() ? (r = t.getChildAtIndex(n - 1), i = !0) : (r = t.getChildAtIndex(n), i = !1), N(r)) {
			e.set(r.__key, i ? r.getTextContentSize() : 0, "text", !0);
			break;
		}
		if (!B(r)) break;
		e.set(r.__key, i ? r.getChildrenSize() : 0, "element", !0);
	}
}
var on = Symbol.for("@lexical/CachedTextSize");
function sn(e, t) {
	return Sn.read(() => {
		let n = 0, r = e;
		for (let e = 0; e < t && r !== null; e++) {
			let i = xn.get(r);
			if (i === void 0 && T(345, r), B(i)) {
				let a = Cn.get(r);
				if (a !== void 0 && B(a) && a.__parent !== i.__parent) n += i.getTextContentSize();
				else {
					let e = wn.get(r), t = e && e.__lexicalTextContent;
					typeof t != "string" && T(346, i.getType()), n += t.length;
				}
				e < t - 1 && !i.isInline() && (n += 2);
			} else {
				let e = i[on];
				e === void 0 && T(347, i.getType(), r), n += e;
			}
			r = i.__next;
		}
		return n;
	}, { editor: k });
}
function cn(e) {
	B(e) || e[on] === void 0 && (e[on] = N(e) ? e.__text.length : e.getTextContentSize());
}
var ln = 4, un, k, dn, A = "", fn = null, pn = null, mn = null;
function hn() {
	return {
		firstTextKey: mn,
		format: fn,
		style: pn
	};
}
function gn(e) {
	e.firstTextKey !== null && (fn = e.format, pn = e.style, mn = e.firstTextKey);
}
function _n(e) {
	if (mn !== null) return;
	let t = e.__lexicalFirstTextKey;
	if (t === void 0 && T(348), t === null) return;
	let n = Cn.get(t);
	N(n) && (fn = n.getFormat(), pn = n.getStyle(), mn = t);
}
var vn, yn, bn, xn, Sn, Cn, wn, Tn, En, Dn, On = !1, kn = !1;
function An(e, t) {
	let n = xn.get(e), r = Cn.has(e);
	if (t !== null) {
		let n = tr(e);
		n.parentNode === t && t.removeChild(n);
	}
	if (!r) {
		if (k._keyToDOMMap.delete(e), B(n)) {
			let e = ku(n, xn);
			jn(e, 0, e.length - 1, null);
		}
		if (n !== void 0) {
			for (let e of Bn(n).values()) {
				let t = Hn(e);
				An(e, null), t !== null && t.remove();
			}
			Yc(En, dn, vn, n, "destroyed");
		}
	}
}
function jn(e, t, n, r) {
	for (let i = t; i <= n; ++i) {
		let t = e[i];
		t !== void 0 && An(t, r);
	}
}
function Mn(e, t) {
	e.setProperty("text-align", t);
}
var Nn = "40px";
function Pn(e, t) {
	let n = un.theme.indent;
	if (typeof n == "string") {
		let r = e.classList.contains(n);
		t > 0 && !r ? e.classList.add(n) : t < 1 && r && e.classList.remove(n);
	}
	e.style.setProperty("padding-inline-start", t === 0 ? "" : `calc(${t} * var(--lexical-indent-base-value, ${Nn}))`), qc(e, "class"), qc(e, "style");
}
function Fn(e, t) {
	let n = e.style;
	t === 0 ? Mn(n, "") : t === 1 ? Mn(n, "left") : t === 2 ? Mn(n, "center") : t === 3 ? Mn(n, "right") : t === 4 ? Mn(n, "justify") : t === 5 ? Mn(n, "start") : t === 6 && Mn(n, "end"), qc(e, "style");
}
function In(e, t) {
	let n = function(e) {
		let t = e.__dir;
		if (t !== null) return t;
		if (ps(e)) return null;
		let n = e.getParent();
		return n === null || fl(n) && n.__dir === null ? "auto" : null;
	}(t);
	n === null ? e.removeAttribute("dir") : e.dir = n;
}
function Ln(e) {
	let t = El().createElement("div");
	return t.setAttribute("data-lexical-slot", e), t.style.display = "none", t;
}
function Rn(e, t, n) {
	t || e.contentEditable === "false" ? $l(n, k) : n.removeAttribute("contenteditable");
}
function zn(e, t, n) {
	let r = A, i = hn();
	A = "";
	let a = "", o = V(e);
	for (let [r, i] of n) {
		let n = Ln(r);
		Rn(t, o, n), t.appendChild(n), A = "";
		let s = hn();
		Wn(i, Bl(e, n, k)), gn(s), Vn(e, r, t, n), a += A;
	}
	return gn(i), A = r, a;
}
function Bn(e) {
	return Mu(e) && e.__slots !== null ? e.__slots : ju;
}
function Vn(e, t, n, r) {
	let i = Dn.$getSlotTargetElement(e, t, n, k);
	i !== null && (r.parentElement !== i && i.appendChild(r), r.style.display = "");
}
function Hn(e) {
	let t = wn.get(e);
	return t === void 0 ? null : t.parentElement;
}
function Un(e, t, n) {
	let r = Bn(e), i = Bn(t);
	for (let [e, t] of r) if (!i.has(e)) {
		let e = Hn(t);
		An(t, null), e !== null && e.remove();
	}
	let a = A, o = hn(), s = "", c = null, l = V(t);
	for (let [e, a] of i) {
		let i = r.get(e), o = i === void 0 ? null : Hn(i);
		A = "";
		let u = hn();
		if (o === null) {
			o = Ln(e);
			let r = null;
			for (let e of n.children) if (!e.hasAttribute("data-lexical-slot")) {
				r = e;
				break;
			}
			n.insertBefore(o, r), Wn(a, Bl(t, o, k));
		} else i === a ? Xn(a, o) : (i !== void 0 && An(i, o), Wn(a, Bl(t, o, k)));
		if (gn(u), Rn(n, l, o), Vn(t, e, n, o), s += A, o.parentElement === n) {
			let e = c === null ? n.firstChild : c.nextSibling;
			e !== o && n.insertBefore(o, e), c = o;
		}
	}
	return gn(o), A = a, s;
}
function Wn(e, t) {
	let n = Cn.get(e);
	if (n === void 0 && T(60), t !== null) {
		let r = xn.get(e);
		if (r !== void 0) {
			let i = wn.get(e);
			if (i !== void 0) {
				let a = Nu(r) ? r.__slotHost : null, o = Nu(n) ? n.__slotHost : null, s = r.__parent !== n.__parent || a !== o, c = o !== null && i.parentElement !== t.element;
				if (s || c) return t.insertChild(i), Xn(e, t.element);
			}
		}
	}
	let r = Dn.$createDOM(n, k);
	if (function(e, t, n) {
		let r = n._keyToDOMMap;
		Dc(t, n, e), r.set(e, t);
	}(e, r, k), N(n) ? r.setAttribute("data-lexical-text", "true") : V(n) && (r.setAttribute("data-lexical-decorator", "true"), Zl(r, { captureSelection: !0 })), B(n)) {
		let e = n.__indent, t = n.__size;
		In(r, n), e !== 0 && Pn(r, e);
		let i = Bn(n), a = i.size > 0 ? zn(n, r, i) : "";
		if (t === 0) r.__lexicalTextContent = a, r.__lexicalFirstTextKey = null, A += a, i.size > 0 && (r.__lexicalSlotTextLength = a.length);
		else {
			let e = A, o = t - 1;
			if (Gn(ku(n, Cn), n, 0, o, Bl(n, r, k)), a !== "") {
				let t = r.__lexicalTextContent || "";
				r.__lexicalTextContent = a + t, A = e + a + t;
			}
			i.size > 0 && (r.__lexicalSlotTextLength = a.length);
		}
		let o = n.__format;
		o !== 0 && Fn(r, o), n.isInline() || (Jn(0, n, r), qn(n, r));
	} else {
		let t = n.getTextContent();
		if (V(n)) {
			let t = n.decorate(k, un);
			t !== null && Zn(e, t), r.contentEditable = "false";
			let i = Bn(n);
			i.size > 0 && zn(n, r, i);
		}
		A += t;
	}
	return t !== null && t.insertChild(r), Dn.$decorateDOM(n, null, r, k), cn(n), Yc(En, dn, vn, n, "created"), r;
}
function Gn(e, t, n, r, i) {
	let a = A, o = hn();
	A = "", fn = null, pn = null, mn = null;
	let s = n;
	for (; s <= r; ++s) {
		let t = hn();
		Wn(e[s], i);
		let n = Cn.get(e[s]);
		n !== null && N(n) ? fn === null && (fn = n.getFormat(), pn = n.getStyle(), mn = n.__key) : B(n) && s < r && !n.isInline() && (A += De), gn(t);
	}
	let c = k._keyToDOMMap.get(t.__key);
	c === void 0 && T(349, t.__key), c.__lexicalTextContent = A, c.__lexicalFirstTextKey = mn, A = a + A, gn(o);
}
function Kn(e, t) {
	if (!e) return !1;
	let n = t.get(e);
	return V(n) && !n.isInline();
}
function qn(e, t) {
	let n = Bl(e, t, k);
	n.setDecoratorBoundaryAnchor("leading", Kn(e.__first, Cn)), n.setDecoratorBoundaryAnchor("trailing", Kn(e.__last, Cn));
}
function Jn(e, t, n) {
	let r = Bl(t, n, k), i = function(e, t) {
		if (e) {
			let n = e.__last;
			if (n) {
				let e = t.get(n);
				if (e) return Cs(e) ? "line-break" : V(e) && e.isInline() ? "decorator" : null;
			}
			return "empty";
		}
		return null;
	}(t, Cn);
	r.setManagedLineBreak(i);
}
function Yn(e, t, n) {
	let r = t.__lexicalFirstTextKey;
	if (r != null) {
		let t = e.__key, i = r;
		for (; i !== null;) {
			let e = Cn.get(i);
			if (e === void 0) {
				i = null;
				break;
			}
			if (e.__parent === t) break;
			i = e.__parent;
		}
		if (i !== null && !n.has(i)) {
			let e = Cn.get(r);
			if (N(e)) return fn = e.getFormat(), void (pn = e.getStyle());
		}
	}
	t.__lexicalFirstTextKey = mn;
}
function Xn(e, t) {
	let n = xn.get(e), r = Cn.get(e);
	n !== void 0 && r !== void 0 || T(61);
	let i = On || bn.has(e) || yn.has(e), a = $c(k, e);
	if (n === r && !i) {
		let e;
		if (B(n)) {
			let t = a.__lexicalTextContent;
			typeof t != "string" && T(355, n.getType()), e = t, _n(a);
		} else e = n.getTextContent();
		return A += e, a;
	}
	if (n !== r && i && Yc(En, dn, vn, r, "updated"), Dn.$updateDOM(r, n, a, k)) {
		let n = Wn(e, null);
		return t === null && T(62), t.replaceChild(n, a), An(e, null), n;
	}
	if (B(n)) {
		B(r) || T(334, e);
		let t = r.__indent;
		(On || t !== n.__indent) && Pn(a, t);
		let o = r.__format;
		(On || o !== n.__format) && Fn(a, o);
		let s = i && (Bn(r).size > 0 || Bn(n).size > 0) ? Un(n, r, a) : "";
		if (i) {
			let e = A;
			if (function(e, t, n) {
				var r;
				fn = null, pn = null, mn = null, function(e, t, n) {
					let r = A, i = e.__size, a = t.__size;
					A = "";
					let o = n.element, s = k._keyToDOMMap.get(t.__key);
					s === void 0 && T(351, t.__key);
					let c = a - i;
					if (!On && Math.abs(c) <= 1 && i >= ln && e.__first === t.__first && (c !== 0 || !k._cloneNotNeeded.has(e.__key))) {
						let i = s.__lexicalTextContent, l = Tn.get(e.__key);
						if (!On && typeof i == "string" && l !== void 0) {
							let a = function(e, t) {
								let n = t.size;
								if (n === 0 || n >= e.__size) return null;
								let r = e.__last, i = null, a = 0;
								for (; r !== null && a < n;) {
									if (!t.has(r)) return null;
									i = r;
									let e = Cn.get(r);
									if (e === void 0) return null;
									r = e.__prev, a++;
								}
								return a !== n || r !== null && t.has(r) ? null : i;
							}(t, l);
							if (a !== null) {
								let u = l.size;
								if (c === 0) {
									let e = sn(a, u), n = a, c = 0;
									for (; n !== null && c < u;) {
										let e = Cn.get(n);
										if (e === void 0) break;
										let t = hn();
										Xn(n, o), N(e) && fn === null && (fn = e.getFormat(), pn = e.getStyle(), mn = e.__key), gn(t), n = e.__next, c++;
									}
									let d = "";
									for (n = a, c = 0; n !== null && c < u;) {
										let e = Cn.get(n);
										if (e === void 0) break;
										let t;
										if (B(e)) {
											let r = k._keyToDOMMap.get(n), i = r && r.__lexicalTextContent;
											typeof i != "string" && T(352, e.getType()), t = i;
										} else t = e.getTextContent();
										d += t, c < u - 1 && B(e) && !e.isInline() && (d += De), n = e.__next, c++;
									}
									let f = s.__lexicalSlotTextLength || 0, p = f > 0 ? i.slice(f) : i, m = p.slice(0, p.length - e) + d;
									s.__lexicalTextContent = m, A = r + m, Yn(t, s, l);
									return;
								}
								if (function(e, t, n, r, i, a, o, s) {
									if (s !== 1 && s !== -1 || o !== (s === 1 ? 2 : 1)) return !1;
									let c = o - s, l = e.__last;
									for (let e = 0; e < c - 1; e++) {
										if (l === null) return !1;
										let e = xn.get(l);
										if (e === void 0) return !1;
										l = e.__prev;
									}
									if (l === null) return !1;
									let u = Cn.get(a), d = xn.get(l);
									if (u === void 0 || d === void 0 || u.__prev !== d.__prev) return !1;
									let f = [], p = a;
									for (let e = 0; e < o; e++) {
										if (p === null) return !1;
										f.push(p);
										let e = Cn.get(p);
										p = e ? e.__next : null;
									}
									let m = [];
									p = l;
									for (let e = 0; e < c; e++) {
										if (p === null) return !1;
										m.push(p);
										let e = xn.get(p);
										p = e ? e.__next : null;
									}
									let h = new Set(m), g = new Set(f), _ = [], v = 0, y = 0;
									for (; v < c && y < o;) if (f[y] === m[v]) _.push({
										key: f[y],
										kind: "reconcile"
									}), v++, y++;
									else if (g.has(m[v])) {
										if (h.has(f[y])) return !1;
										_.push({
											key: f[y],
											kind: "create",
											nextIndex: y
										}), y++;
									} else _.push({
										key: m[v],
										kind: "destroy"
									}), v++;
									for (; v < c;) _.push({
										key: m[v++],
										kind: "destroy"
									});
									for (; y < o;) _.push({
										key: f[y],
										kind: "create",
										nextIndex: y
									}), y++;
									let b = sn(l, c);
									for (let e of _) {
										let t = hn();
										if (e.kind === "reconcile") Xn(e.key, n.element);
										else if (e.kind === "destroy") An(e.key, n.element);
										else {
											let t = null;
											for (let n = e.nextIndex + 1; n < o; n++) {
												let e = k._keyToDOMMap.get(f[n]);
												if (e !== void 0) {
													t = e;
													break;
												}
											}
											Wn(e.key, n.withBefore(t ?? n.before));
										}
										if (e.kind !== "destroy") {
											let t = Cn.get(e.key);
											t && N(t) && fn === null && (fn = t.getFormat(), pn = t.getStyle(), mn = t.__key);
										}
										gn(t);
									}
									let x = "";
									for (let e = 0; e < o; e++) {
										let t = Cn.get(f[e]);
										if (t === void 0) return !1;
										let n;
										if (B(t)) {
											let r = k._keyToDOMMap.get(f[e]), i = r && r.__lexicalTextContent;
											typeof i != "string" && T(350, t.getType()), n = i;
										} else n = t.getTextContent();
										x += n, e < o - 1 && B(t) && !t.isInline() && (x += De);
									}
									let S = r.__lexicalSlotTextLength || 0, C = S > 0 ? i.slice(S) : i;
									return r.__lexicalTextContent = C.slice(0, C.length - b) + x, !0;
								}(e, 0, n, s, i, a, u, c)) {
									let e = s.__lexicalTextContent;
									typeof e != "string" && T(353), A = r + e, Yn(t, s, l);
									return;
								}
							}
						}
						if (c === 0) {
							let t = e.__first, n = 0;
							for (; t !== null;) {
								let e = Cn.get(t);
								if (e === void 0) break;
								let r = On || bn.has(t) || yn.has(t), i = hn();
								if (r) Xn(t, o);
								else {
									let n, r;
									if (B(e)) {
										r = wn.get(t);
										let i = r && r.__lexicalTextContent;
										typeof i != "string" && T(354, e.getType()), n = i;
									} else n = e.getTextContent();
									A += n, r !== void 0 && _n(r);
								}
								N(e) ? fn === null && (fn = e.getFormat(), pn = e.getStyle(), mn = e.__key) : B(e) && n < a - 1 && !e.isInline() && (A += De), gn(i), t = e.__next, n++;
							}
							s.__lexicalTextContent = A, s.__lexicalFirstTextKey = mn, A = r + A;
							return;
						}
					}
					if (i === 1 && a === 1) {
						let r = e.__first, i = t.__first;
						if (r === i) Xn(r, o);
						else {
							let e = tr(r), t = Wn(i, null);
							try {
								e.parentNode === o ? o.replaceChild(t, e) : n.insertChild(t);
							} catch (n) {
								if (typeof n == "object" && n) {
									let a = `${n.toString()} Parent: ${o.tagName}, new child: {tag: ${t.tagName} key: ${i}}, old child: {tag: ${e.tagName}, key: ${r}}.`;
									throw Error(a);
								}
								throw n;
							}
							An(r, null);
						}
						let a = Cn.get(i);
						N(a) && fn === null && (fn = a.getFormat(), pn = a.getStyle(), mn = a.__key);
					} else {
						let r = ku(e, xn), s = ku(t, Cn);
						if (r.length !== i && T(227), s.length !== a && T(228), i === 0) a !== 0 && Gn(s, t, 0, a - 1, n);
						else if (a === 0) {
							if (i !== 0) {
								let e = n.after == null && n.before == null && Bn(t).size === 0 && n.element.__lexicalLineBreak == null;
								jn(r, 0, i - 1, e ? null : o), e && (o.textContent = "");
							}
						} else (function(e, t, n, r, i, a) {
							let o = r - 1, s = i - 1, c, l, u = a.getFirstChild(), d = 0, f = 0;
							for (; d <= o && f <= s;) {
								let e = t[d], r = n[f], i = hn();
								if (e === r) u = Qn(Xn(r, a.element)), d++, f++;
								else {
									if (l === void 0 && (l = $n(n, f)), c === void 0) c = $n(t, d);
									else if (!c.has(e)) {
										d++, gn(i);
										continue;
									}
									if (!l.has(e)) {
										u = Qn(tr(e)), An(e, a.element), d++, c.delete(e), gn(i);
										continue;
									}
									if (c.has(r)) {
										let e = $c(k, r);
										e !== u && a.withBefore(u ?? a.before).insertChild(e), u = Qn(Xn(r, a.element)), d++, f++;
									} else Wn(r, a.withBefore(u ?? a.before)), f++;
								}
								let o = Cn.get(r);
								o !== null && N(o) ? fn === null && (fn = o.getFormat(), pn = o.getStyle(), mn = o.__key) : B(o) && f <= s && !o.isInline() && (A += De), gn(i);
							}
							let p = d > o, m = f > s;
							if (p && !m) {
								let t = n[s + 1], r = t === void 0 ? null : k.getElementByKey(t);
								Gn(n, e, f, s, a.withBefore(r ?? a.before));
							} else m && !p && jn(t, d, o, a.element);
						})(t, r, s, i, a, n);
					}
					s.__lexicalTextContent = A, s.__lexicalFirstTextKey = mn, A = r + A;
				}(e, t, Bl(t, n, k)), fl(t) || (r = t, fn == null || fn === r.__textFormat || kn || r.setTextFormat(fn), function(e) {
					pn == null || pn === e.__textStyle || kn || e.setTextStyle(pn);
				}(t));
			}(n, r, a), r.isInline() || (ps(r) || Jn(0, r, a), qn(r, a)), s !== "") {
				let t = a.__lexicalTextContent || "";
				a.__lexicalTextContent = s + t, A = e + s + t, a.__lexicalSlotTextLength = s.length;
			} else (Bn(r).size > 0 || Bn(n).size > 0) && (a.__lexicalSlotTextLength = 0);
		} else {
			let e = a.__lexicalTextContent;
			typeof e != "string" && T(356, n.getType()), A += e, _n(a);
		}
		if ((On || r.__dir !== n.__dir || r.__parent !== n.__parent) && (In(a, r), ps(r) && !On)) for (let e of r.getChildren()) B(e) && In($c(k, e.getKey()), e);
	} else {
		let t = r.getTextContent();
		if (V(r)) {
			let t = r.decorate(k, un);
			t !== null && Zn(e, t), i && (Bn(r).size > 0 || Bn(n).size > 0) && Un(n, r, a);
		}
		A += t;
	}
	if (!kn && ps(r)) {
		let e = r.getLatest();
		if (e.__cachedText !== A) {
			let t = e.getWritable();
			t.__cachedText = A, r = t;
		}
	}
	return Dn.$decorateDOM(r, n, a, k), cn(r), a;
}
function Zn(e, t) {
	let n = k._pendingDecorators, r = k._decorators;
	if (n === null) {
		if (r[e] === t) return;
		n = Ac(k);
	}
	n[e] = t;
}
function Qn(e) {
	let t = e.nextSibling;
	return t !== null && t === k._blockCursorElement && (t = t.nextSibling), t;
}
function $n(e, t) {
	let n = /* @__PURE__ */ new Set();
	for (let r = t; r < e.length; r++) n.add(e[r]);
	return n;
}
function er(e, t, n, r, i, a) {
	A = "", fn = null, pn = null, mn = null, On = r === 2, k = n, un = n._config, Dn = n._config.dom || Qs, dn = n._nodes, vn = k._listeners.mutation, yn = i, bn = a, xn = e._nodeMap, Sn = e, Cn = t._nodeMap, kn = t._readOnly, wn = Ze(n._keyToDOMMap), Tn = function() {
		let e = /* @__PURE__ */ new Map(), t = (t) => {
			for (let n of t) {
				let t = Cn.get(n);
				if (t === void 0) continue;
				let r = t.__parent;
				if (r === null) continue;
				let i = e.get(r);
				i === void 0 && (i = /* @__PURE__ */ new Set(), e.set(r, i)), i.add(n);
			}
		};
		return t(yn.keys()), t(bn), e;
	}();
	let o = /* @__PURE__ */ new Map();
	return En = o, Xn("root", null), k = void 0, dn = void 0, yn = void 0, bn = void 0, xn = void 0, Sn = void 0, Cn = void 0, un = void 0, wn = void 0, Tn = void 0, En = void 0, Dn = Qs, o;
}
function tr(e) {
	let t = wn.get(e);
	return t === void 0 && T(75, e), t;
}
function nr(e) {
	return () => {};
}
function j(e) {
	return { type: e };
}
var rr = /* @__PURE__ */ j("SELECTION_CHANGE_COMMAND"), ir = /* @__PURE__ */ j("CLICK_COMMAND"), ar = /* @__PURE__ */ j("BEFORE_INPUT_COMMAND"), or = /* @__PURE__ */ j("INPUT_COMMAND"), sr = /* @__PURE__ */ j("COMPOSITION_START_COMMAND"), cr = /* @__PURE__ */ j("COMPOSITION_END_COMMAND"), lr = /* @__PURE__ */ j("DELETE_CHARACTER_COMMAND"), ur = /* @__PURE__ */ j("INSERT_LINE_BREAK_COMMAND"), dr = /* @__PURE__ */ j("INSERT_PARAGRAPH_COMMAND"), fr = /* @__PURE__ */ j("CONTROLLED_TEXT_INSERTION_COMMAND"), pr = /* @__PURE__ */ j("PASTE_COMMAND"), mr = /* @__PURE__ */ j("REMOVE_TEXT_COMMAND"), hr = /* @__PURE__ */ j("DELETE_WORD_COMMAND"), gr = /* @__PURE__ */ j("DELETE_LINE_COMMAND"), _r = /* @__PURE__ */ j("FORMAT_TEXT_COMMAND"), vr = /* @__PURE__ */ j("UNDO_COMMAND"), yr = /* @__PURE__ */ j("REDO_COMMAND"), br = /* @__PURE__ */ j("KEYDOWN_COMMAND"), xr = /* @__PURE__ */ j("KEY_ARROW_RIGHT_COMMAND"), Sr = /* @__PURE__ */ j("MOVE_TO_END"), Cr = /* @__PURE__ */ j("KEY_ARROW_LEFT_COMMAND"), wr = /* @__PURE__ */ j("MOVE_TO_START"), Tr = /* @__PURE__ */ j("KEY_ARROW_UP_COMMAND"), Er = /* @__PURE__ */ j("KEY_ARROW_DOWN_COMMAND"), Dr = /* @__PURE__ */ j("KEY_ENTER_COMMAND"), Or = /* @__PURE__ */ j("KEY_SPACE_COMMAND"), kr = /* @__PURE__ */ j("KEY_BACKSPACE_COMMAND"), Ar = /* @__PURE__ */ j("KEY_ESCAPE_COMMAND"), jr = /* @__PURE__ */ j("KEY_DELETE_COMMAND"), Mr = /* @__PURE__ */ j("KEY_TAB_COMMAND"), Nr = /* @__PURE__ */ j("DROP_COMMAND"), Pr = /* @__PURE__ */ j("DRAGSTART_COMMAND"), Fr = /* @__PURE__ */ j("DRAGOVER_COMMAND"), Ir = /* @__PURE__ */ j("DRAGEND_COMMAND"), Lr = /* @__PURE__ */ j("COPY_COMMAND"), Rr = /* @__PURE__ */ j("CUT_COMMAND"), zr = /* @__PURE__ */ j("SELECT_ALL_COMMAND"), Br = /* @__PURE__ */ j("CLEAR_EDITOR_COMMAND"), Vr = /* @__PURE__ */ j("CLEAR_HISTORY_COMMAND"), Hr = /* @__PURE__ */ j("CAN_REDO_COMMAND"), Ur = /* @__PURE__ */ j("CAN_UNDO_COMMAND"), Wr = /* @__PURE__ */ j("FOCUS_COMMAND"), Gr = /* @__PURE__ */ j("BLUR_COMMAND"), Kr = /* @__PURE__ */ j("KEY_MODIFIER_COMMAND");
function qr(e, t) {
	return {
		...t,
		[Ie]: e
	};
}
var Jr = /* @__PURE__ */ qr("metaKey", {
	ctrlKey: !me,
	metaKey: me
}), Yr = /* @__PURE__ */ qr("altKey", {
	altKey: me,
	ctrlKey: !me
}), Xr = [
	["altKey", 1],
	["ctrlKey", 2],
	["metaKey", 4],
	["shiftKey", 8]
];
function Zr(e, t, n) {
	let r = e.get(t);
	r ? r.push(n) : e.set(t, [n]);
}
var Qr = class {
	byKey = /* @__PURE__ */ new Map();
	byCode = /* @__PURE__ */ new Map();
	add(e) {
		let { key: t, modifiers: n = {} } = e;
		t.length > 0 || T(399);
		let r = t.toLowerCase();
		for (let i of function(e) {
			let t = [0];
			for (let [n, r] of Xr) {
				let i = e[n] || !1;
				i === "any" ? t = t.concat(t.map((e) => e | r)) : i && (t = t.map((e) => e | r));
			}
			return t;
		}(n)) Zr(this.byKey, `${i}:${r}`, e), t.length === 1 && (/[0-9]/.test(t) ? Zr(this.byCode, `${i}:Digit${t}`, e) : /[a-z]/.test(r) && Zr(this.byCode, `${i}:Key${r.toUpperCase()}`, e));
		return this;
	}
	matches(e) {
		let t = e.key;
		if (!t) return [];
		let n = function(e) {
			let t = 0;
			for (let [n, r] of Xr) e[n] && (t |= r);
			return t;
		}(e), r = this.byKey.get(`${n}:${t.toLowerCase()}`), i = r ? r.slice() : [];
		if (this.byCode.size > 0 && !(t.length === 1 && t.charCodeAt(0) <= 127)) {
			let t = this.byCode.get(`${n}:${e.code}`);
			t && i.push(...t);
		}
		return i;
	}
	match(e) {
		return this.matches(e)[0];
	}
};
function $r(e) {
	let t = new Qr();
	for (let n of e) t.add(n);
	return t;
}
function ei(e) {
	let t = /* @__PURE__ */ new Map();
	return {
		dispose() {
			for (let e of t.values()) e.dispose();
			t.clear();
		},
		register(n, r) {
			let i = t.get(n);
			i === void 0 && (i = {
				dispose: e(n, r),
				holders: /* @__PURE__ */ new Set()
			}, t.set(n, i));
			let a = () => {
				let e = t.get(n);
				e && e.holders.delete(a) && e.holders.size === 0 && (t.delete(n), e.dispose());
			};
			return i.holders.add(a), a;
		}
	};
}
function ti(e, t, n, r) {
	return e.addEventListener(t, n, r), e.removeEventListener.bind(e, t, n, r);
}
var ni = /* @__PURE__ */ Object.freeze({}), ri, ii = /* @__PURE__ */ new WeakMap(), ai = /* @__PURE__ */ new WeakMap(), oi = /* @__PURE__ */ ei((e) => (e.addEventListener("selectionchange", Li), () => e.removeEventListener("selectionchange", Li)));
function si(e, t, n, r, i, a) {
	let o = e.anchor, s = e.focus, c = o.getNode(), l = z(), u;
	if (a !== void 0) u = a;
	else {
		let e = yl(cl(l));
		u = e === null ? null : kl(e, l._rootElement);
	}
	let d = u === null ? null : u.anchorNode, f = o.key, p = l.getElementByKey(f), m = n.length;
	return f !== s.key || !N(c) || (!i && (!ge || l._inputState.lastBeforeInputInsertTextTimeStamp < r + 50) || c.isDirty() && m < 2 || Lc(n)) && o.offset !== s.offset && !c.isComposing() || gc(c) || c.isDirty() && m > 1 || (i || !ge) && p !== null && !c.isComposing() && d !== Hl(c, p, l) || u !== null && t !== null && (!t.collapsed || t.startContainer !== u.anchorNode || t.startOffset !== u.anchorOffset) || !c.isComposing() && (c.getFormat() !== e.format || c.getStyle() !== e.style) || function(e, t) {
		if (t.isSegmented()) return !0;
		if (!e.isCollapsed()) return !1;
		let n = e.anchor.offset, r = t.getParentOrThrow(), i = hc(t);
		return n === 0 ? !t.canInsertTextBefore() || !r.canInsertTextBefore() && !t.isComposing() || i || function(e) {
			let t = e.getPreviousSibling();
			return (N(t) || B(t) && t.isInline()) && !t.canInsertTextAfter();
		}(t) : n === t.getTextContentSize() && (!t.canInsertTextAfter() || !r.canInsertTextAfter() && !t.isComposing() || i);
	}(e, c);
}
function ci(e, t) {
	return _c(e) && e.nodeValue !== null && t !== 0 && t !== e.nodeValue.length;
}
function li(e, t, n) {
	let { anchorNode: r, anchorOffset: i, focusNode: a, focusOffset: o } = kl(e, t._rootElement), s = t._inputState;
	if (s.isSelectionChangeFromDOMUpdate) {
		s.isSelectionChangeFromDOMUpdate = !1;
		let e = s.selectionChangeFromDOMUpdatePoints;
		if (s.selectionChangeFromDOMUpdatePoints = null, ci(r, i) && ci(a, o) && !s.postDeleteSelectionToRestore && (e === null || e.anchorNode === r && e.anchorOffset === i && e.focusNode === a && e.focusOffset === o)) return;
	}
	ns(t, () => {
		if (!n) return void Pc(null);
		if (!dc(t, r, a)) return;
		let c = F();
		if (s.postDeleteSelectionToRestore && P(c) && c.isCollapsed()) {
			let e = c.anchor, t = s.postDeleteSelectionToRestore.anchor;
			(e.key === t.key && e.offset === t.offset + 1 || e.offset === 1 && t.getNode().is(e.getNode().getPreviousSibling())) && (c = s.postDeleteSelectionToRestore.clone(), Pc(c));
		}
		if (s.postDeleteSelectionToRestore = null, P(c)) {
			let n = c.anchor, l = n.getNode();
			if (c.isCollapsed()) {
				e.type === "Range" && r === a && (c.dirty = !0);
				let i = cl(t).event, o = i ? i.timeStamp : performance.now(), { format: u, style: d, offset: f, key: p, timeStamp: m } = s.collapsedSelectionFormat, h = Mc(), g = !1 === t.isComposing() && h.getTextContent() === "";
				if (o < m + 200 && n.offset === f && n.key === p) ui(c, u, d);
				else if (n.type === "text") N(l) || T(141), di(c, l);
				else if (n.type === "element" && !g) {
					B(l) || T(259);
					let e = n.getNode();
					e.isEmpty() ? function(e, t) {
						ui(e, t.getTextFormat(), t.getTextStyle());
					}(c, e) : ui(c, c.format, "");
				}
			} else {
				let e = n.key, t = c.focus.key, r = c.getNodes(), a = r.length, s = c.isBackward(), l = s ? o : i, u = s ? i : o, d = s ? t : e, f = s ? e : t, p = Te, m = !1;
				for (let e = 0; e < a; e++) {
					let t = r[e], n = t.getTextContentSize();
					if (N(t) && n !== 0 && !(e === 0 && t.__key === d && l === n || e === a - 1 && t.__key === f && u === 0) && (m = !0, p &= t.getFormat(), p === 0)) break;
				}
				c.format = m ? p : 0;
			}
		}
		(function(e, t, n = !1) {
			(n || Zo(e, t)) && e.dispatchCommand(rr);
		})(t, c, c !== null && (c.dirty || !P(c)));
	});
}
function ui(e, t, n) {
	e.format === t && e.style === n || (e.format = t, e.style = n, e.dirty = !0);
}
function di(e, t) {
	ui(e, t.getFormat(), t.getStyle());
}
function fi(e, t) {
	ns(t, () => {
		let n = F(), r = yl(cl(t)), i = po();
		if (r) {
			if (P(n)) {
				let e = n.anchor, t = e.getNode();
				e.type === "element" && e.offset === 0 && n.isCollapsed() && !ps(t) && Mc().getChildrenSize() === 1 && t.getTopLevelElementOrThrow().isEmpty() && i !== null && n.is(i) && (r.removeAllRanges(), n.dirty = !0);
			} else if (e.pointerType === "touch" || e.pointerType === "pen") {
				let n = kl(r, t._rootElement).anchorNode;
				(W(n) || _c(n)) && Pc(fo(i, r, t, e));
			}
		}
		if (O && r !== null && r.rangeCount === 0) {
			let n = t._rootElement;
			if (n !== null && e.target === n) {
				let a = e.clientY, o = n.childNodes.length;
				for (let e = 0; e < n.childNodes.length; e++) {
					let t = n.childNodes[e];
					if (W(t)) {
						let n = t.getBoundingClientRect();
						if (a <= (n.top + n.bottom) / 2) {
							o = e;
							break;
						}
					}
				}
				r.setBaseAndExtent(n, o, n, o);
				let s = fo(i, r, t, e);
				s === null ? r.removeAllRanges() : Pc(s);
			}
		}
		U(t, ir, e);
	});
}
function pi(e, t) {
	let n = Fl(e), r = e.pointerType;
	Il(n) && r !== "touch" && r !== "pen" && e.button === 0 && ns(t, () => {
		eu(n, t) || (t._inputState.isSelectionChangeFromMouseDown = !0);
	});
}
function mi(e) {
	if (!e.getTargetRanges) return null;
	let t = e.getTargetRanges();
	return t.length === 0 ? null : t[0];
}
function hi(e) {
	let { lastKeyCode: t } = z()._inputState;
	if (e == null || e.length <= 1 || t == null) return;
	let n = t.length === 1 ? t : t === "Enter" ? "\n" : t === "Tab" ? "	" : null;
	if (!n) return;
	let r = F();
	if (!P(r) || !r.isCollapsed()) return;
	let i = r.anchor.getNode();
	if (!N(i)) return;
	let { offset: a } = r.anchor;
	if (i.getTextContentSize() === a) {
		let e = i.getNextSibling();
		if (n === "\n") {
			if (ve) return;
			if (Cs(e)) e.selectEnd();
			else if (!e) {
				let e = Ou(i, so), t = e && e.getNextSibling();
				B(t) && t.selectStart();
			}
		} else n === "	" ? Ma(e) && e.selectEnd() : N(e) && e.getTextContent()[0] === n && e.select(1, 1);
	} else i.getTextContent()[a] === n && i.select(a + 1, a + 1);
}
function gi(e) {
	e.isInsertTextAfterHandledSelectionCommand = !1, e.handledSelectionCommandTimeoutId !== null && (clearTimeout(e.handledSelectionCommandTimeoutId), e.handledSelectionCommandTimeoutId = null);
}
function _i(e) {
	me && !ve && xe && (gi(e), e.isInsertTextAfterHandledSelectionCommand = !0, e.handledSelectionCommandTimeoutId = setTimeout(() => gi(e), 0));
}
function vi(e, t) {
	let n = Fl(e);
	if (W(n) && eu(n, t)) return !0;
	let r = t.getRootElement();
	if (r === null) return !1;
	let i = Pl(r.ownerDocument);
	return i !== null && r.contains(i) && eu(i, t);
}
function yi(e) {
	let t = e.inputType, n = mi(e), r = z(), i = r._inputState, a = F();
	if (t === "insertText" && e.data && i.isInsertTextAfterHandledSelectionCommand) {
		if (gi(i), e.preventDefault(), P(a) && !a.isCollapsed()) {
			let e = a.isBackward() ? a.anchor : a.focus;
			a.anchor.set(e.key, e.offset, e.type), a.focus.set(e.key, e.offset, e.type);
		}
		return !0;
	}
	if (t === "deleteContentBackward") {
		if (a === null) {
			let e = po();
			if (!P(e)) return !0;
			Pc(e.clone());
		}
		if (P(a)) {
			let t = a.anchor.key === a.focus.key;
			if (function(e, t) {
				return e.lastKeyCode === "MediaLast" && t < e.lastKeyDownTimeStamp + 30;
			}(i, e.timeStamp) && r.isComposing() && t) {
				if (wc(null), i.lastKeyDownTimeStamp = 0, setTimeout(() => {
					ns(r, () => {
						wc(null);
					});
				}, 30), P(a)) {
					let e = a.anchor.getNode();
					e.markDirty(), N(e) || T(142), di(a, e);
				}
			} else {
				if (wc(null), ve && n !== null && !n.collapsed && (a.applyDOMRange(n), !a.isCollapsed())) return e.preventDefault(), a.removeText(), !0;
				e.preventDefault();
				let o = a.anchor.getNode(), s = o.getTextContent(), c = o.canInsertTextAfter(), l = a.anchor.offset === 0 && a.focus.offset === s.length, u = Se && t && !l && c;
				if (u && a.isCollapsed() && (u = !V(Zc(a.anchor, !0))), !u) {
					U(r, lr, !0);
					let e = F();
					Se && P(e) && e.isCollapsed() && (i.postDeleteSelectionToRestore = e, setTimeout(() => i.postDeleteSelectionToRestore = null));
				}
			}
			return !0;
		}
	}
	if (!P(a)) return t !== "historyUndo" && t !== "historyRedo" || (e.preventDefault(), U(r, t === "historyUndo" ? vr : yr)), !0;
	let o = e.data;
	i.unprocessedBeforeInputData !== null && Vc(!1, r, i.unprocessedBeforeInputData), a.dirty && i.unprocessedBeforeInputData === null || !a.isCollapsed() || ps(a.anchor.getNode()) || n === null || a.applyDOMRange(n), i.unprocessedBeforeInputData = null;
	let s = a.anchor, c = a.focus, l = s.getNode(), u = c.getNode();
	if (t === "insertText" || t === "insertTranspose") {
		if (o === "\n") e.preventDefault(), U(r, ur, !1);
		else if (o === De) e.preventDefault(), U(r, dr);
		else if (o == null && e.dataTransfer) {
			let t = e.dataTransfer.getData("text/plain");
			e.preventDefault(), a.insertRawText(t);
		} else o != null && si(a, n, o, e.timeStamp, !0) ? (e.preventDefault(), U(r, fr, o), hi(o)) : i.unprocessedBeforeInputData = o;
		return i.lastBeforeInputInsertTextTimeStamp = e.timeStamp, !0;
	}
	switch (e.preventDefault(), t) {
		case "insertFromYank":
		case "insertFromDrop":
		case "insertReplacementText":
			U(r, fr, e), hi((e.dataTransfer ? e.dataTransfer.getData("text/plain") : null) ?? e.data);
			break;
		case "insertFromComposition": {
			let t = i.hadOrphanedCompositionEvents;
			i.hadOrphanedCompositionEvents = !1;
			let n = r._compositionKey;
			wc(null), t || U(r, fr, e), Ti(n);
			break;
		}
		case "insertLineBreak":
			wc(null), i.isInsertLineBreak = !1, U(r, ur, !1);
			break;
		case "insertParagraph":
			wc(null), i.isInsertLineBreak ? (i.isInsertLineBreak = !1, U(r, ur, !1)) : U(r, dr);
			break;
		case "insertFromPaste":
		case "insertFromPasteAsQuotation":
			U(r, pr, e);
			break;
		case "deleteByComposition":
			(function(e, t) {
				return e !== t || B(e) || B(t) || !hc(e) || !hc(t);
			})(l, u) && U(r, mr, e);
			break;
		case "deleteByDrag":
			il(Xi), U(r, mr, e);
			break;
		case "deleteByCut":
			U(r, mr, e);
			break;
		case "deleteContent":
			U(r, lr, !1);
			break;
		case "deleteWordBackward":
			U(r, hr, !0);
			break;
		case "deleteWordForward":
			U(r, hr, !1);
			break;
		case "deleteHardLineBackward":
		case "deleteSoftLineBackward":
			U(r, gr, !0);
			break;
		case "deleteContentForward":
		case "deleteHardLineForward":
		case "deleteSoftLineForward":
			U(r, gr, !1);
			break;
		case "formatStrikeThrough":
			U(r, _r, "strikethrough");
			break;
		case "formatBold":
			U(r, _r, "bold");
			break;
		case "formatItalic":
			U(r, _r, "italic");
			break;
		case "formatUnderline":
			U(r, _r, "underline");
			break;
		case "historyUndo":
			U(r, vr);
			break;
		case "historyRedo": U(r, yr);
	}
	return !0;
}
function bi(e, t) {
	e.stopPropagation();
	let n = t._inputState;
	gi(n), ns(t, () => {
		vi(e, t) || t.dispatchCommand(or, e);
	}, { event: e }), n.unprocessedBeforeInputData = null;
}
function xi(e) {
	let t = z(), n = t._inputState, r = F(), i = e.data, a = mi(e), o = !1;
	if (i != null && P(r)) {
		let s = yl(cl(t)), c = s === null ? null : kl(s, t._rootElement), l = e.inputType === "insertCompositionText" && n.compositionPhase !== "ending-firefox" && !t.isComposing();
		l && (n.hadOrphanedCompositionEvents = !0);
		let u = r.anchor.getNode(), d = e.inputType === "insertCompositionText" && n.compositionPhase !== "ending-firefox" && t.isComposing() && N(u) && gc(u);
		if (!l && !d && si(r, a, i, e.timeStamp, !1, c)) {
			if (o = !0, n.compositionPhase === "ending-firefox") {
				let e = Ei(t, i);
				if (n.compositionPhase = "idle", e) return il(Zi), Fc(), !0;
			}
			let a = r.anchor.getNode();
			if (s === null || c === null) return !0;
			let l = r.isBackward(), u = l ? r.anchor.offset : r.focus.offset, d = l ? r.focus.offset : r.anchor.offset;
			ge && !r.isCollapsed() && N(a) && c.anchorNode !== null && a.getTextContent().slice(0, u) + i + a.getTextContent().slice(u + d) === Bc(c.anchorNode) || U(t, fr, i);
			let f = i.length;
			O && f > 1 && e.inputType === "insertCompositionText" && !t.isComposing() && (r.anchor.offset -= f, r._cachedNodes = null, r._cachedIsBackward = null), Se && t.isComposing() && (n.lastKeyDownTimeStamp = 0, wc(null));
		}
	}
	return o || (Vc(!1, t, i === null ? void 0 : i), n.compositionPhase === "ending-firefox" && (Ei(t, i || void 0), il("composition-end"), n.compositionPhase = "idle")), Fc(), !0;
}
function Si(e, t) {
	U(t, sr, e);
}
function Ci(e) {
	let t = z(), n = t._inputState, r = F();
	if (P(r) && !t.isComposing()) {
		n.compositionPhase = "composing", n.hadOrphanedCompositionEvents = !1;
		let i = r.anchor, a = r.anchor.getNode();
		if (wc(i.key), il("composition-start"), e.timeStamp < n.lastKeyDownTimeStamp + 30 || i.type === "element" || !r.isCollapsed() || !Se && (a.getFormat() !== r.format || N(a) && a.getStyle() !== r.style) || N(a) && (gc(a) || i.offset === 0 && !a.canInsertTextBefore() || i.offset === a.getTextContentSize() && !a.canInsertTextAfter())) {
			U(t, fr, Oe);
			let e = F();
			P(e) && wc(e.anchor.key);
		}
	}
	return !0;
}
function wi(e) {
	let t = z();
	return t._inputState.compositionPhase = "idle", Ei(t, e.data), il(Zi), !0;
}
function Ti(e) {
	if (e === null) return;
	let t = H(e);
	if (!N(t) || t.getType() === "text" || gc(t) || !t.isAttached()) return;
	let n = F(), r = P(n) && n.anchor.key === e ? n.anchor.offset : null, i = Da(t.getTextContent());
	if (i.setFormat(t.getFormat()), i.setStyle(t.getStyle()), t.replace(i), r !== null) {
		let e = Math.min(r, i.getTextContentSize());
		i.select(e, e);
	}
}
function Ei(e, t) {
	let n = e._compositionKey;
	if (wc(null), n !== null && t != null) {
		if (t === "") {
			let t = H(n), r = e.getElementByKey(n), i = r !== null && N(t) ? Hl(t, r, e) : null;
			if (i !== null && i.nodeValue !== null && N(t)) {
				let n = yl(cl(e)), r = n && kl(n, e._rootElement), a = null, o = null;
				r !== null && r.anchorNode === i && (a = r.anchorOffset, o = r.focusOffset), Hc(t, i.nodeValue, a, o, !0);
			}
			return Ti(n), !1;
		}
		if (t[t.length - 1] === "\n") {
			let t = F();
			if (P(t) || Ha(t)) {
				if (P(t)) {
					let e = t.focus;
					t.anchor.set(e.key, e.offset, e.type);
				}
				return U(e, Dr, null), Ti(n), !1;
			}
		}
		let r = H(n);
		if (r !== null && N(r) && gc(r)) {
			r.markDirty();
			let e = F(), i = r.getTextContentSize(), a = P(e) && e.anchor.key === n ? e.anchor.offset : i;
			return r.select(a, a).insertText(t), !0;
		}
	}
	return Vc(!0, e, t), Ti(n), !1;
}
function Di(e, t) {
	let n = t._inputState;
	O ? n.compositionPhase = "ending-firefox" : ve || !be && !Ce ? U(t, cr, e) : (n.compositionPhase = "ending-safari", n.compositionEndData = e.data);
}
function Oi(e, t) {
	let n = t._inputState;
	ve && (n.isShiftKeyDown = e.key === "Shift" || n.isShiftKeyDown && e.shiftKey && e.key !== "CapsLock"), n.lastKeyDownTimeStamp = e.timeStamp, n.lastKeyCode = e.key, e.key !== "Backspace" && gi(n), t.isComposing() || U(t, br, e);
}
var ki = {
	altKey: "any",
	ctrlKey: "any",
	metaKey: "any",
	shiftKey: "any"
}, Ai = { ctrlKey: !0 }, ji = { metaKey: !0 }, Mi = { shiftKey: "any" }, Ni = {
	altKey: "any",
	shiftKey: "any"
};
function Pi(e) {
	let t = z(), n = t._inputState;
	if (e.key == null) return !0;
	if (n.compositionPhase === "ending-safari") {
		let r = function(e) {
			return e.key === "Backspace";
		}(e);
		if (r && ns(t, () => {
			Ei(t, n.compositionEndData);
		}), n.compositionPhase = "idle", n.compositionEndData = "", r) return !0;
	}
	let r = t._keyDownShortcuts;
	r === null && (r = $r(function() {
		let e = (e, t, n) => ({
			key: e,
			modifiers: t,
			onMatch: (e, t) => {
				U(t, n, e);
			}
		}), t = (e, t, n, r) => ({
			key: e,
			modifiers: t,
			onMatch: (e, t) => {
				e.preventDefault(), U(t, n, r);
			}
		}), n = (e, t) => ({
			key: "Enter",
			modifiers: e,
			onMatch: (e, n) => {
				let r = n._inputState;
				r.isInsertLineBreak = t && (!ve || r.isShiftKeyDown), U(n, Dr, e), e.defaultPrevented && (r.isInsertLineBreak = !1);
			}
		}), r = (e, t) => ({
			key: e,
			modifiers: Jr,
			onMatch: (e, n) => {
				let r = n._editorState._selection;
				r === null || P(r) || (e.preventDefault(), U(n, t, e));
			}
		});
		return [
			e("ArrowRight", Mi, xr),
			e("ArrowLeft", Mi, Cr),
			e("ArrowUp", Ni, Tr),
			e("ArrowDown", Ni, Er),
			n({
				...ki,
				shiftKey: !0
			}, !0),
			n({
				...ki,
				shiftKey: !1
			}, !1),
			e(" ", ki, Or),
			{
				key: "Backspace",
				modifiers: Mi,
				onMatch: (e, t) => {
					U(t, kr, e) && _i(t._inputState);
				}
			},
			e("Escape", ki, Ar),
			e("Delete", {}, jr),
			t("Backspace", Yr, hr, !0),
			t("Delete", Yr, hr, !1),
			t("b", Jr, _r, "bold"),
			t("u", Jr, _r, "underline"),
			t("i", Jr, _r, "italic"),
			e("Tab", Mi, Mr),
			t("z", Jr, vr, void 0),
			t("z", {
				...Jr,
				shiftKey: !0
			}, yr, void 0),
			...me ? [
				{
					key: "o",
					modifiers: Ai,
					onMatch: (e, t) => {
						e.preventDefault(), U(t, ur, !0);
					}
				},
				e("ArrowLeft", {
					metaKey: !0,
					...Mi
				}, wr),
				e("ArrowRight", {
					metaKey: !0,
					...Mi
				}, Sr),
				t("h", Ai, lr, !0),
				t("d", Ai, lr, !1),
				t("Backspace", ji, gr, !0),
				t("Delete", ji, gr, !1),
				t("k", Ai, gr, !1)
			] : [
				e("Home", Mi, wr),
				e("End", Mi, Sr),
				t("y", Ai, yr, void 0)
			],
			{
				key: "a",
				modifiers: Jr,
				onMatch: (e, t) => {
					e.preventDefault(), U(t, zr, e) && _i(t._inputState);
				}
			},
			r("c", Lr),
			r("x", Rr)
		];
	}()), t._keyDownShortcuts = r);
	let i = r.match(e);
	return i && i.onMatch(e, t), function(e) {
		return e.ctrlKey || e.shiftKey || e.altKey || e.metaKey;
	}(e) && t.dispatchCommand(Kr, e), !0;
}
function Fi(e) {
	let t = e.__lexicalEventHandles;
	return t === void 0 && (t = [], e.__lexicalEventHandles = t), t;
}
var Ii = /* @__PURE__ */ new Map();
function Li(e) {
	let t = bl(e.target);
	if (t === null) return;
	let n = tl(e.target), r = null, i = null, a = n === null ? void 0 : ai.get(n);
	if (n !== null) {
		if (a !== void 0) {
			let e = a.editors, n = a.hasShadowEditor;
			if (n === void 0) {
				n = !1;
				for (let t of e) if (t._rootElement !== null && xl(t._rootElement.getRootNode())) {
					n = !0;
					break;
				}
				a.hasShadowEditor = n;
			}
			if (n) {
				let n = null, a = null;
				for (let o of e) {
					let e = o._rootElement;
					if (e === null) continue;
					let s = kl(t, e).anchorNode;
					if (s !== null && pc(s) === o) {
						if (xl(e.getRootNode())) {
							r = o, i = s;
							break;
						}
						n === null && (n = o, a = s);
					}
				}
				r === null && n !== null && (r = n, i = a);
			} else {
				let e = t.anchorNode;
				e === null || W(e) && e.shadowRoot !== null || (r = pc(e), r !== null && (i = e));
			}
		}
		if (r === null) {
			let e = Pl(n);
			r = e === null ? null : pc(e);
		}
	}
	if (r === null) return;
	if (r._inputState.isSelectionChangeFromMouseDown) {
		if (a !== void 0) for (let e of a.editors) e._inputState.isSelectionChangeFromMouseDown = !1;
		ns(r, () => {
			let n = po(), a = i ?? kl(t, r._rootElement).anchorNode;
			(W(a) || _c(a)) && Pc(fo(n, t, r, e));
		});
	}
	let o = Rc(r), s = o[o.length - 1], c = s._key, l = Ii.get(c), u = l || s;
	u !== r && li(t, u, !1), li(t, r, !0), r === s ? l && Ii.delete(c) : Ii.set(c, r);
}
function Ri(e) {
	e._lexicalHandled = !0;
}
function zi(e) {
	return !0 === e._lexicalHandled;
}
var Bi = /* @__PURE__ */ nr();
function Vi(e, t, n) {
	Lo();
	let r = e.__key, i = e.getParent();
	if (i === null) return void (Pu(e) !== null && T(367, r, String(Pu(e))));
	let a = function(e) {
		let t = F();
		if (!P(t) || !B(e)) return t;
		let { anchor: n, focus: r } = t, i = n.getNode(), a = r.getNode();
		return ol(i, e) && n.set(e.__key, 0, "element"), ol(a, e) && r.set(e.__key, 0, "element"), t;
	}(e), o = !1;
	if (P(a) && t) {
		let t = a.anchor, n = a.focus;
		t.key === r && (go(t, e, i, e.getPreviousSibling(), e.getNextSibling()), o = !0), n.key === r && (go(n, e, i, e.getPreviousSibling(), e.getNextSibling()), o = !0);
	} else Ha(a) && t && e.isSelected() && e.selectPrevious();
	if (P(a) && t && !o && mo(a, i)) {
		let t = e.getIndexWithinParent();
		Sc(e), I(a, i, t, -1);
	} else Sc(e);
	n || fl(i) || i.canBeEmpty() || !i.isEmpty() || Vi(i, t), t && a && ps(i) && i.isEmpty() && i.selectEnd();
}
var M = Symbol.for("ephemeral");
function Hi(e) {
	return e[M] || !1;
}
var Ui = {
	configurable: !0,
	enumerable: !1,
	value: void 0,
	writable: !0
}, Wi = class {
	__type;
	__key;
	__parent;
	__prev;
	__next;
	__state;
	static getType() {
		let { ownNodeType: e } = xu(this);
		return e === void 0 && T(64, this.name), e;
	}
	static clone(e) {
		T(65, this.name);
	}
	$config() {
		return {};
	}
	config(e, t) {
		let n = t.extends || Au(this.constructor);
		return Object.assign(t, { extends: n }), typeof e == "string" && Object.assign(t, { type: e }), { [e]: t };
	}
	afterCloneFrom(e) {
		this.__key === e.__key ? (this.__parent = e.__parent, this.__next = e.__next, this.__prev = e.__prev, this.__state = e.__state) : e.__state && (this.__state = e.__state.getWritable(this));
	}
	resetOnCopyNodeFrom(e) {
		this.__state &&= this.__state.getWritable(this).resetOnCopyNode();
	}
	static importDOM;
	constructor(e) {
		this.__type = this.constructor.getType(), this.__parent = null, this.__prev = null, this.__next = null, Object.defineProperty(this, "__state", Ui), Object.defineProperty(this, on, Ui), xc(this, e);
	}
	getType() {
		return this.__type;
	}
	isInline() {
		T(137, this.constructor.name);
	}
	isAttached() {
		let e = this.__key;
		for (; e !== null;) {
			if (e === "root") return !0;
			let t = H(e);
			if (t === null) break;
			e = t.__parent === null ? Pu(t) : t.__parent;
		}
		return !1;
	}
	isSelected(e) {
		let t = e || F();
		if (t == null) return !1;
		let n = t.getNodes().some((e) => e.__key === this.__key);
		if (N(this)) return n;
		if (P(t) && t.anchor.type === "element" && t.focus.type === "element") {
			if (t.isCollapsed()) return !1;
			let e = this.getParent();
			if (V(this) && this.isInline() && e) {
				let n = t.isBackward() ? t.focus : t.anchor;
				if (e.is(n.getNode()) && n.offset === e.getChildrenSize() && this.is(e.getLastChild())) return !1;
			}
		}
		return n;
	}
	getKey() {
		return this.__key;
	}
	getIndexWithinParent() {
		let e = this.getParent();
		if (e === null) return -1;
		let t = e.getFirstChild(), n = 0;
		for (; t !== null;) {
			if (this.is(t)) return n;
			n++, t = t.getNextSibling();
		}
		return -1;
	}
	getParent() {
		let e = this.getLatest().__parent;
		return e === null ? null : H(e);
	}
	getParentOrThrow() {
		let e = this.getParent();
		return e === null && T(66, this.__key), e;
	}
	getTopLevelElement() {
		let e = this;
		for (; e !== null;) {
			let t = e.getParent();
			if (fl(t) || Pu(e) !== null) return B(e) || e === this && V(e) || T(194), e;
			e = t;
		}
		return null;
	}
	getTopLevelElementOrThrow() {
		let e = this.getTopLevelElement();
		return e === null && T(67, this.__key), e;
	}
	getParents() {
		let e = [], t = this.getParent();
		for (; t !== null;) e.push(t), t = t.getParent();
		return e;
	}
	getParentKeys() {
		let e = [], t = this.getParent();
		for (; t !== null;) e.push(t.__key), t = t.getParent();
		return e;
	}
	getPreviousSibling() {
		let e = this.getLatest().__prev;
		return e === null ? null : H(e);
	}
	getPreviousSiblings() {
		let e = [], t = this.getParent();
		if (t === null) return e;
		let n = t.getFirstChild();
		for (; n !== null && !n.is(this);) e.push(n), n = n.getNextSibling();
		return e;
	}
	getNextSibling() {
		let e = this.getLatest().__next;
		return e === null ? null : H(e);
	}
	getNextSiblings() {
		let e = [], t = this.getNextSibling();
		for (; t !== null;) e.push(t), t = t.getNextSibling();
		return e;
	}
	is(e) {
		return e != null && this.__key === e.__key;
	}
	isBefore(e) {
		let t = Od(this, e);
		return t !== null && (t.type === "descendant" || (t.type === "branch" ? Td(t) === -1 : (t.type !== "same" && t.type !== "ancestor" && T(279), !1)));
	}
	isParentOf(e) {
		return ol(e, this);
	}
	getNodesBetween(e) {
		let t = this.isBefore(e), n = [], r = /* @__PURE__ */ new Set(), i = this;
		for (; i !== null;) {
			let a = i.__key;
			if (r.has(a) || (r.add(a), n.push(i)), i === e) break;
			let o = B(i) ? t ? i.getFirstChild() : i.getLastChild() : null;
			if (o !== null) {
				i = o;
				continue;
			}
			let s = t ? i.getNextSibling() : i.getPreviousSibling();
			if (s !== null) {
				i = s;
				continue;
			}
			let c = i.getParentOrThrow();
			if (r.has(c.__key) || n.push(c), c === e) break;
			let l = null, u = c;
			do {
				if (u === null && T(68), l = t ? u.getNextSibling() : u.getPreviousSibling(), u = u.getParent(), u === null) break;
				l !== null || r.has(u.__key) || n.push(u);
			} while (l === null);
			i = l;
		}
		return t || n.reverse(), n;
	}
	isDirty() {
		let e = z()._dirtyLeaves;
		return e !== null && e.has(this.__key);
	}
	getLatest() {
		if (Hi(this)) return this;
		let e = H(this.__key);
		return e === null && T(113), e;
	}
	getWritable() {
		if (Hi(this)) return this;
		Lo();
		let e = zo(), t = z(), n = this.__key, r = t._cloneNotNeeded, i = r.get(n), a = e._selection;
		if (a !== null && a.setCachedNodes(null), i !== void 0) return Cc(i), i;
		let o = e._nodeMap, s = o.get(n);
		s === void 0 && T(113);
		let c = Kl(s);
		return r.set(n, c), o.set(n, c), Cc(c), c;
	}
	getTextContent() {
		return qu(this);
	}
	getTextContentSize() {
		return this.getTextContent().length;
	}
	createDOM(e, t) {
		T(70);
	}
	updateDOM(e, t, n) {
		T(71);
	}
	getDOMSlot(e) {
		return new Ue(e);
	}
	exportDOM(e) {
		return { element: Y(e).$createDOM(this, e) };
	}
	exportJSON(e = !1) {
		let t = function(e, t) {
			let n = iu(ru(e.constructor)), { generated: r, isCompactDefault: i } = n, a = r === null ? void 0 : t ? r.exportCompactJSON : r.exportJSON;
			return a === void 0 ? function(e, t, n) {
				let r = n ? { type: e.__type } : {};
				return B(e) && (r.children = []), function(e, t, n, r) {
					for (let i = 0; i < t.length; i++) {
						let a = t[i];
						if (r && a.derived) continue;
						let o;
						if (a.kind === "ownField") {
							let t = gu(e)[a.field];
							o = a.getterTable === void 0 ? t : kt(a.getterTable, t) ? a.getterTable[t] : void 0;
						} else o = a.getter.call(e);
						a.kind === "ownField" && a.when !== void 0 && (!_u(a, o) && a.when.call(e) || (o = void 0)), r && _u(a, o) || (n[a.key] = o);
					}
				}(e, t, r, n), n || (r.type = e.__type, r.version = 1), r;
			}(e, n.getters, t) : t ? a(e, i) : a(e);
		}(this, e), n = this.__state ? this.__state.toJSON() : void 0;
		return n !== void 0 && Object.assign(t, n), t;
	}
	static importJSON(e) {
		T(18, this.name);
	}
	updateFromJSON(e) {
		return bu(Jt(this, e), e);
	}
	static transform() {
		return null;
	}
	remove(e) {
		Vi(this, !0, e);
	}
	replace(e, t) {
		Lo();
		let n = F();
		n !== null && (n = n.clone()), hl(this, e);
		let r = this.getLatest(), i = this.__key, a = Fu(r);
		a !== null && T(400, i, r.getType(), a.getKey(), a.getType());
		let o = e.__key, s = e.getWritable(), c = this.getParentOrThrow().getWritable(), l = c.__size, u = s.getParent(), d = u !== null && P(n) && mo(n, u), f = d ? s.getIndexWithinParent() : -1;
		Sc(s), d && u !== null && P(n) && I(n, u, f, -1);
		let p = r.getPreviousSibling(), m = r.getNextSibling(), h = r.__prev, g = r.__next, _ = r.__parent;
		Vi(r, !1, !0), p === null ? c.__first = o : p.getWritable().__next = o, s.__prev = h, m === null ? c.__last = o : m.getWritable().__prev = o, s.__next = g, s.__parent = _, c.__size = u !== null && u.is(c) ? l - 1 : l;
		let v = 0;
		if (t && (B(this) && B(s) || T(139), v = s.getChildrenSize(), s.splice(v, 0, this.getChildren())), P(n)) {
			Pc(n);
			let e = n.anchor, r = n.focus;
			e.key === i && (t && e.type === "element" ? e.set(s.__key, v + e.offset, "element") : Ia(e, s)), r.key === i && (t && r.type === "element" ? r.set(s.__key, v + r.offset, "element") : Ia(r, s));
		}
		return Tc() === i && wc(o), s;
	}
	insertAfter(e, t = !0) {
		Lo(), hl(this, e);
		let n = this.getWritable(), r = e.getWritable();
		this.getParentOrThrow();
		let i = r.getParent(), a = F(), o = !1, s = !1, c = -1;
		if (i !== null && t && P(a) && mo(a, i)) {
			let t = i.__key, n = a.anchor, r = a.focus;
			c = e.getIndexWithinParent(), o = n.type === "element" && n.key === t && n.offset === c + 1, s = r.type === "element" && r.key === t && r.offset === c + 1;
		}
		Sc(r), c !== -1 && i !== null && P(a) && I(a, i, c, -1);
		let l = this.getNextSibling(), u = this.getParentOrThrow().getWritable(), d = r.__key, f = n.__next;
		if (l === null ? u.__last = d : l.getWritable().__prev = d, u.__size++, n.__next = d, r.__next = f, r.__prev = n.__key, r.__parent = n.__parent, t && P(a)) {
			let e = u.__key;
			if (o || s || mo(a, u)) {
				let t = this.getIndexWithinParent();
				I(a, u, t + 1), o && a.anchor.set(e, t + 2, "element"), s && a.focus.set(e, t + 2, "element");
			}
		}
		return e;
	}
	insertBefore(e, t = !0) {
		Lo(), hl(this, e);
		let n = this.getWritable(), r = e.getWritable();
		this.getParentOrThrow();
		let i = r.__key, a = F(), o = r.getParent(), s = o !== null && t && P(a) && mo(a, o), c = s ? r.getIndexWithinParent() : -1;
		Sc(r), s && o !== null && P(a) && I(a, o, c, -1);
		let l = this.getPreviousSibling(), u = this.getParentOrThrow().getWritable(), d = n.__prev, f = t && P(a) && mo(a, u), p = f ? this.getIndexWithinParent() : -1;
		return l === null ? u.__first = i : l.getWritable().__next = i, u.__size++, n.__prev = i, r.__prev = d, r.__next = n.__key, r.__parent = n.__parent, f && P(a) && I(a, u, p), e;
	}
	isParentRequired() {
		return !1;
	}
	createParentElementNode() {
		return qs();
	}
	selectStart() {
		return this.selectPrevious();
	}
	selectEnd() {
		return this.selectNext(0, 0);
	}
	selectPrevious(e, t) {
		Lo();
		let n = Fu(this);
		if (n !== null) return n.selectPrevious(e, t);
		let r = this.getPreviousSibling(), i = this.getParentOrThrow();
		if (r === null) return i.select(0, 0);
		if (B(r)) return r.select();
		if (!N(r)) {
			let e = r.getIndexWithinParent() + 1;
			return i.select(e, e);
		}
		return r.select(e, t);
	}
	selectNext(e, t) {
		Lo();
		let n = Fu(this);
		if (n !== null) return n.selectNext(e, t);
		let r = this.getNextSibling(), i = this.getParentOrThrow();
		if (r === null) return i.select();
		if (B(r)) return r.select(0, 0);
		if (!N(r)) {
			let e = r.getIndexWithinParent();
			return i.select(e, e);
		}
		return r.select(e, t);
	}
	markDirty() {
		this.getWritable();
	}
	reconcileObservedMutation(e, t) {
		this.markDirty();
	}
};
function Gi(e) {
	return e instanceof Wi;
}
var Ki = "history-push", qi = "history-merge", Ji = "skip-scroll-into-view", Yi = "skip-dom-selection", Xi = "skip-selection-focus", Zi = "composition-end", Qi = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
function $i(e, t) {
	if (typeof e == "number") return Number.isFinite(e) ? e : t;
	if (typeof e != "string" || !Qi.test(e)) return t;
	let n = Number(e);
	return Number.isFinite(n) ? n : t;
}
function ea(e, t, n, r, i) {
	let a = $i(e, t);
	return a >= n && a <= r && Number.isInteger(a) ? a : t;
}
var ta = (e) => {
	let t = _t(e, "format"), n = vt(e, "format"), r = bt(e, "format");
	return {
		exportJSON: function(e) {
			let n = e.__textFormat, r = e.__textStyle, i = (n !== 0 || r !== "") && e.shouldSerializeTextStyles();
			return {
				children: [],
				direction: e.__dir,
				format: t[e.__format],
				indent: e.__indent,
				textFormat: n !== 0 && i ? n : void 0,
				textStyle: r !== "" && i ? r : void 0,
				type: e.__type,
				version: 1
			};
		},
		exportCompactJSON: function(e) {
			let n = e.__textFormat, r = e.__textStyle, i = (n !== 0 || r !== "") && e.shouldSerializeTextStyles(), a = {
				type: e.__type,
				children: []
			}, o = e.__dir;
			o != null && (a.direction = o);
			let s = t[e.__format];
			s !== void 0 && s !== "" && (a.format = s);
			let c = e.__indent;
			return c !== void 0 && c !== 0 && (a.indent = c), n !== void 0 && n !== 0 && i && (a.textFormat = n), r !== void 0 && r !== "" && i && (a.textStyle = r), a;
		},
		updateFromJSON: function(e, t) {
			let i = t.direction;
			e.__dir = i === null || i === "ltr" || i === "rtl" ? i : null;
			let a = t.format;
			e.__format = typeof a == "string" && a in n ? n[a] : r, e.__indent = ea(t.indent, 0, 0, Infinity), e.__textFormat = $i(t.textFormat, 0);
			let o = t.textStyle;
			return e.__textStyle = typeof o == "string" ? o : "", e;
		}
	};
};
function na(e, t) {
	e.__detail = t.__detail, e.__format = t.__format, e.__mode = t.__mode, e.__style = t.__style, e.__text = t.__text;
}
var ra = (e) => {
	let t = _t(e, "mode"), n = yt(e, "detail", 0), r = yt(e, "format", 0), i = vt(e, "mode"), a = bt(e, "mode");
	return {
		exportJSON: function(e) {
			return {
				detail: e.__detail,
				format: e.__format,
				mode: t[e.__mode],
				style: e.__style,
				text: e.__text,
				type: e.__type,
				version: 1
			};
		},
		exportCompactJSON: function(e) {
			let n = { type: e.__type }, r = e.__detail;
			r !== void 0 && r !== 0 && (n.detail = r);
			let i = e.__format;
			i !== void 0 && i !== 0 && (n.format = i);
			let a = t[e.__mode];
			a !== void 0 && a !== "normal" && (n.mode = a);
			let o = e.__style;
			o !== void 0 && o !== "" && (n.style = o);
			let s = e.__text;
			return s !== void 0 && s !== "" && (n.text = s), n;
		},
		updateFromJSON: function(e, t) {
			let o = t.detail;
			e.__detail = typeof o == "string" && o in n ? n[o] : $i(o, 0);
			let s = t.format;
			e.__format = typeof s == "string" && s in r ? r[s] : $i(s, 0);
			let c = t.mode;
			e.__mode = typeof c == "string" && c in i ? i[c] : a;
			let l = t.style;
			e.__style = typeof l == "string" ? l : "";
			let u = t.text;
			return e.__text = typeof u == "string" ? u : "", e;
		},
		afterCloneFrom: na
	};
}, ia = (e) => {
	let t = _t(e, "format"), n = vt(e, "format"), r = bt(e, "format");
	return {
		exportJSON: function(e) {
			let n = e.__textFormat, r = e.__textStyle, i = (n !== 0 || r !== "") && e.shouldSerializeTextStyles();
			return {
				children: [],
				direction: e.__dir,
				format: t[e.__format],
				indent: e.__indent,
				textFormat: n !== 0 && i ? n : void 0,
				textStyle: r !== "" && i ? r : void 0,
				type: e.__type,
				version: 1
			};
		},
		exportCompactJSON: function(e) {
			let n = e.__textFormat, r = e.__textStyle, i = (n !== 0 || r !== "") && e.shouldSerializeTextStyles(), a = {
				type: e.__type,
				children: []
			}, o = e.__dir;
			o != null && (a.direction = o);
			let s = t[e.__format];
			s !== void 0 && s !== "" && (a.format = s);
			let c = e.__indent;
			return c !== void 0 && c !== 0 && (a.indent = c), n !== void 0 && n !== 0 && i && (a.textFormat = n), r !== void 0 && r !== "" && i && (a.textStyle = r), a;
		},
		updateFromJSON: function(e, t) {
			let i = t.direction;
			e.__dir = i === null || i === "ltr" || i === "rtl" ? i : null;
			let a = t.format;
			e.__format = typeof a == "string" && a in n ? n[a] : r, e.__indent = ea(t.indent, 0, 0, Infinity), e.__textFormat = $i(t.textFormat, 0);
			let o = t.textStyle;
			return e.__textStyle = typeof o == "string" ? o : "", e;
		}
	};
}, aa = () => ({
	exportJSON: function(e) {
		return {
			type: e.__type,
			version: 1
		};
	},
	exportCompactJSON: function(e) {
		return { type: e.__type };
	}
}), oa = (e) => {
	let t = _t(e, "mode"), n = yt(e, "format", 0);
	return {
		exportJSON: function(e) {
			return {
				detail: e.__detail,
				mode: t[e.__mode],
				text: e.__text,
				format: e.__format,
				style: e.__style,
				type: e.__type,
				version: 1
			};
		},
		exportCompactJSON: function(e) {
			let t = { type: e.__type }, n = e.__format;
			n !== void 0 && n !== 0 && (t.format = n);
			let r = e.__style;
			return r !== void 0 && r !== "" && (t.style = r), t;
		},
		updateFromJSON: function(e, t) {
			let r = t.format;
			e.__format = typeof r == "string" && r in n ? n[r] : $i(r, 0);
			let i = t.style;
			return e.__style = typeof i == "string" ? i : "", e;
		}
	};
};
function sa(e) {
	let t = {};
	if (!e) return t;
	let n = "", r = "", i = null, a = !1, o = !1, s = !1, c = 0, l = e.length, u = -1;
	for (let d = 0; d < l; d++) {
		let l = e[d];
		if (a) l === "*" && e[d + 1] === "/" && (a = !1, d++);
		else if (o) u === -1 && (u = d), o = !1;
		else if (i === null) {
			if (l !== "/" || e[d + 1] !== "*") {
				if (l !== "\"" && l !== "'") {
					if (l !== "(") {
						if (l !== ")") {
							if (s || l !== ":" || c !== 0) {
								if (l === ";" && c === 0) {
									u !== -1 && (s ? r += e.slice(u, d) : n += e.slice(u, d), u = -1);
									let i = n.trim(), a = r.trim();
									i !== "" && a !== "" && (t[i] = a), n = "", r = "", s = !1;
									continue;
								}
								u === -1 && (u = d);
							} else u !== -1 && (n += e.slice(u, d), u = -1), s = !0;
						} else u === -1 && (u = d), c = Math.max(0, c - 1);
					} else u === -1 && (u = d), c++;
				} else u === -1 && (u = d), i = l;
			} else u !== -1 && (s ? r += e.slice(u, d) : n += e.slice(u, d), u = -1), a = !0, d++;
		} else u === -1 && (u = d), l === "\\" ? o = !0 : l === i && (i = null);
	}
	u !== -1 && (s ? r += e.slice(u, l) : n += e.slice(u, l));
	let d = n.trim(), f = r.trim();
	return d !== "" && f !== "" && (t[d] = f), t;
}
function ca(e, t, n) {
	let r = n.trimEnd(), i = r.length - 10;
	i >= 0 && r.slice(i).toLowerCase() === "!important" ? e.setProperty(t, r.slice(0, i).trim(), "important") : e.setProperty(t, n, "");
}
function la(e, t, n = "") {
	if (t === n) return;
	let r = sa(n), i = sa(t);
	for (let t in i) delete r[t], ca(e, t, i[t]);
	for (let t in r) e.removeProperty(t);
}
var ua = /* @__PURE__ */ Pt()({
	detail: /* @__PURE__ */ It(/* @__PURE__ */ Ft(/* @__PURE__ */ Mt(), Ae), { field: "__detail" }),
	format: /* @__PURE__ */ It(/* @__PURE__ */ Ft(/* @__PURE__ */ Mt(), ke), { field: "__format" }),
	mode: /* @__PURE__ */ It(/* @__PURE__ */ Nt([
		"normal",
		"token",
		"segmented"
	]), {
		field: "__mode",
		getterTable: Fe,
		setterTable: Pe
	}),
	style: /* @__PURE__ */ It(/* @__PURE__ */ At(), { field: "__style" }),
	text: /* @__PURE__ */ It(/* @__PURE__ */ At(), {
		field: "__text",
		getter: "getTextContent",
		setter: "setTextContent"
	})
});
function da(e, t) {
	return 16 & t ? "code" : 128 & t ? "mark" : 32 & t ? "sub" : 64 & t ? "sup" : null;
}
function fa(e, t) {
	return 1 & t ? "strong" : 2 & t ? "em" : "span";
}
function pa(e, t, n, r, i) {
	let a = r.classList, o = Jc(i, "base");
	o !== void 0 && a.add(...o), o = Jc(i, "underlineStrikethrough");
	let s = !1, c = 8 & t && 4 & t;
	o !== void 0 && (8 & n && 4 & n ? (s = !0, c || a.add(...o)) : c && a.remove(...o));
	for (let e in ke) {
		let r = ke[e];
		if (o = Jc(i, e), o !== void 0) {
			if (n & r) {
				if (s && (e === "underline" || e === "strikethrough")) {
					t & r && a.remove(...o);
					continue;
				}
				((t & r) === 0 || c && e === "underline" || e === "strikethrough") && a.add(...o);
			} else t & r && a.remove(...o);
		}
	}
	qc(r, "class");
}
function ma(e, t, n) {
	let r = n.isComposing(), i = e + (r ? Ee : ""), a = J(), o = Y(a).$getDOMSlot(n, t, a), s = o.getFirstChild();
	if (s === null || s.nodeType !== Node.TEXT_NODE) return void o.insertChild(El().createTextNode(i));
	let c = s, l = c.nodeValue;
	if (l !== i) {
		if (r || O) {
			let [e, t, n] = function(e, t) {
				let n = e.length, r = t.length, i = 0, a = 0;
				for (; i < n && i < r && e[i] === t[i];) i++;
				for (; a + i < n && a + i < r && e[n - a - 1] === t[r - a - 1];) a++;
				return [
					i,
					n - i - a,
					t.slice(i, r - a)
				];
			}(l, i);
			t !== 0 && c.deleteData(e, t), c.insertData(e, n);
		} else c.nodeValue = i;
	}
}
function ha(e, t, n, r, i, a) {
	ma(i, e, t);
	let o = a.theme.text;
	o !== void 0 && pa(0, 0, r, e, o);
}
function ga(e, t) {
	let n = El().createElement(t);
	return n.appendChild(e), n;
}
function _a(e) {
	return e != null && !0 === e.__isInlineFormattable;
}
var va = class extends Wi {
	__text;
	__format;
	__style;
	__mode;
	__detail;
	get __isInlineFormattable() {
		return !0;
	}
	$config() {
		return this.config("text", {
			extends: Wi,
			generated: ra,
			importDOM: {
				"#text": () => ({
					conversion: Ca,
					priority: 0
				}),
				b: () => ({
					conversion: ba,
					priority: 0
				}),
				code: () => ({
					conversion: Ea,
					priority: 0
				}),
				em: () => ({
					conversion: Ea,
					priority: 0
				}),
				i: () => ({
					conversion: Ea,
					priority: 0
				}),
				mark: () => ({
					conversion: Ea,
					priority: 0
				}),
				s: () => ({
					conversion: Ea,
					priority: 0
				}),
				span: () => ({
					conversion: ya,
					priority: 0
				}),
				strong: () => ({
					conversion: Ea,
					priority: 0
				}),
				sub: () => ({
					conversion: Ea,
					priority: 0
				}),
				sup: () => ({
					conversion: Ea,
					priority: 0
				}),
				u: () => ({
					conversion: Ea,
					priority: 0
				})
			},
			json: ua
		});
	}
	constructor(e = "", t) {
		super(t), this.__text = e, this.__format = 0, this.__style = "", this.__mode = 0, this.__detail = 0;
	}
	getFormat() {
		return this.getLatest().__format;
	}
	getDetail() {
		return this.getLatest().__detail;
	}
	getMode() {
		return Fe[this.getLatest().__mode];
	}
	getStyle() {
		return this.getLatest().__style;
	}
	isToken() {
		return this.getLatest().__mode === 1;
	}
	isComposing() {
		return this.__key === Tc();
	}
	isSegmented() {
		return this.getLatest().__mode === 2;
	}
	isDirectionless() {
		return !!(1 & this.getLatest().__detail);
	}
	isUnmergeable() {
		return !!(2 & this.getLatest().__detail);
	}
	hasFormat(e) {
		let t = ke[e];
		return (this.getFormat() & t) !== 0;
	}
	isSimpleText() {
		let e = this.getLatest();
		return e.__type === "text" && e.__mode === 0;
	}
	getTextContent() {
		return this.getLatest().__text;
	}
	getFormatFlags(e, t) {
		return bc(this.getLatest().__format, e, t);
	}
	canHaveFormat() {
		return !0;
	}
	isInline() {
		return !0;
	}
	createDOM(e, t) {
		let n = this.__format, r = da(0, n), i = fa(0, n), a = r === null ? i : r, o = El().createElement(a), s = o;
		this.hasFormat("code") && o.setAttribute("spellcheck", "false"), r !== null && (s = El().createElement(i), o.appendChild(s)), ha(s, this, 0, n, this.__text, e);
		let c = this.__style;
		return c !== "" && la(o.style, c), o;
	}
	updateDOM(e, t, n) {
		let r = this.__text, i = e.__format, a = this.__format, o = da(0, i), s = da(0, a), c = fa(0, i), l = fa(0, a);
		if ((o === null ? c : o) !== (s === null ? l : s)) return !0;
		if (o === s && c !== l) {
			let e = t.firstChild;
			e ?? T(48);
			let i = El().createElement(l);
			return ha(i, this, 0, a, r, n), t.replaceChild(i, e), !1;
		}
		let u = t;
		s !== null && o !== null && (u = t.firstChild, u ?? T(49)), ma(r, u, this);
		let d = n.theme.text;
		d !== void 0 && i !== a && pa(0, i, a, u, d);
		let f = e.__style, p = this.__style;
		return f !== p && (la(t.style, p, f), qc(t, "style")), !1;
	}
	exportDOM(e) {
		let { element: t } = super.exportDOM(e);
		return W(t) || T(132), t.style.whiteSpace = "pre-wrap", this.hasFormat("lowercase") ? t.style.textTransform = "lowercase" : this.hasFormat("uppercase") ? t.style.textTransform = "uppercase" : this.hasFormat("capitalize") && (t.style.textTransform = "capitalize"), this.hasFormat("bold") && (t = ga(t, "b")), this.hasFormat("italic") && (t = ga(t, "i")), this.hasFormat("strikethrough") && (t = ga(t, "s")), this.hasFormat("underline") && (t = ga(t, "u")), { element: t };
	}
	selectionTransform(e, t) {}
	setFormat(e) {
		let t = this.getWritable();
		return t.__format = typeof e == "string" ? ke[e] : e, t;
	}
	setDetail(e) {
		let t = this.getWritable();
		return t.__detail = typeof e == "string" ? Ae[e] : e, t;
	}
	setStyle(e) {
		let t = this.getWritable();
		return t.__style = e, t;
	}
	toggleFormat(e) {
		let t = bc(this.getFormat(), e, null);
		return this.setFormat(t);
	}
	toggleDirectionless() {
		let e = this.getWritable();
		return e.__detail ^= 1, e;
	}
	toggleUnmergeable() {
		let e = this.getWritable();
		return e.__detail ^= 2, e;
	}
	setMode(e) {
		let t = Pe[e];
		if (this.getLatest().__mode === t) return this;
		let n = this.getWritable();
		return n.__mode = t, n;
	}
	setTextContent(e) {
		if (this.getLatest().__text === e) return this;
		let t = this.getWritable();
		return t.__text = e, t;
	}
	select(e, t) {
		Lo();
		let n = e, r = t, i = F(), a = this.getTextContent(), o = this.__key;
		if (typeof a == "string") {
			let e = a.length;
			n === void 0 && (n = e), r === void 0 && (r = e);
		} else n = 0, r = 0;
		if (!P(i)) return co(o, n, o, r, "text", "text");
		{
			let e = Tc();
			e !== i.anchor.key && e !== i.focus.key || wc(o), i.setTextNodeRange(this, n, this, r);
		}
		return i;
	}
	selectStart() {
		return this.select(0, 0);
	}
	selectEnd() {
		let e = this.getTextContentSize();
		return this.select(e, e);
	}
	spliceText(e, t, n, r) {
		let i = this.getWritable(), a = i.__text, o = n.length, s = e;
		s < 0 && (s = o + s, s < 0 && (s = 0));
		let c = F();
		if (r && P(c)) {
			let t = e + o;
			c.setTextNodeRange(i, t, i, t);
		}
		return i.__text = a.slice(0, s) + n + a.slice(s + t), i;
	}
	canInsertTextBefore() {
		return !0;
	}
	canInsertTextAfter() {
		return !0;
	}
	splitText(...e) {
		Lo();
		let t = this.getLatest(), n = t.getTextContent();
		if (n === "") return [];
		let r = t.__key, i = Tc(), a = n.length;
		e.sort((e, t) => e - t), e.push(a);
		let o = [], s = e.length;
		for (let t = 0, r = 0; t < a && r <= s; r++) {
			let i = e[r];
			i > t && (o.push(n.slice(t, i)), t = i);
		}
		let c = o.length;
		if (c === 1) return [t];
		let l = o[0], u = t.getParent(), d, f = t.getFormat(), p = t.getStyle(), m = t.__detail, h = !1, g = null, _ = null, v = F();
		if (P(v)) {
			let [e, t] = v.isBackward() ? [v.focus, v.anchor] : [v.anchor, v.focus];
			e.type === "text" && e.key === r && (g = e), t.type === "text" && t.key === r && (_ = t);
		}
		t.isSegmented() ? (d = Da(l), d.__format = f, d.__style = p, d.__detail = m, d.__state = $t(t, d), h = !0) : d = t.setTextContent(l);
		let y = [d];
		for (let e = 1; e < c; e++) {
			let n = Da(o[e]);
			n.__format = f, n.__style = p, n.__detail = m, n.__state = $t(t, n);
			let a = n.__key;
			i === r && wc(a), y.push(n);
		}
		let b = g ? g.offset : null, x = _ ? _.offset : null, S = 0;
		for (let e of y) {
			if (!g && !_) break;
			let t = S + e.getTextContentSize();
			if (g !== null && b !== null && b <= t && b >= S && (g.set(e.getKey(), b - S, "text"), b < t && (g = null)), _ !== null && x !== null && x <= t && x >= S) {
				_.set(e.getKey(), x - S, "text");
				break;
			}
			S = t;
		}
		if (u !== null) {
			(function(e) {
				let t = e.getPreviousSibling(), n = e.getNextSibling();
				t !== null && Cc(t), n !== null && Cc(n);
			})(this);
			let e = u.getWritable(), t = this.getIndexWithinParent();
			h ? (e.splice(t, 0, y), this.remove()) : e.splice(t, 1, y), P(v) && I(v, u, t, c - 1);
		}
		return y;
	}
	mergeWithSibling(e) {
		let t = e === this.getPreviousSibling();
		t || e === this.getNextSibling() || T(50);
		let n = this.__key, r = e.__key, i = this.__text, a = i.length;
		Tc() === r && wc(n);
		let o = F();
		if (P(o)) {
			let i = o.anchor, s = o.focus;
			i !== null && i.key === r && L(i, t, n, e, a), s !== null && s.key === r && L(s, t, n, e, a);
		}
		let s = e.__text, c = t ? s + i : i + s;
		this.setTextContent(c);
		let l = this.getWritable();
		return e.remove(), l;
	}
	isTextEntity() {
		return !1;
	}
};
function ya(e) {
	return {
		forChild: Oa(e.style),
		node: null
	};
}
function ba(e) {
	let t = e, n = t.style.fontWeight === "normal";
	return {
		forChild: Oa(t.style, n ? void 0 : "bold"),
		node: null
	};
}
var xa = /* @__PURE__ */ new WeakMap();
function Sa(e) {
	if (!W(e)) return !1;
	if (e.nodeName === "PRE") return !0;
	let t = e.style.whiteSpace;
	return typeof t == "string" && t.startsWith("pre");
}
function Ca(e) {
	let t = e;
	e.parentElement === null && T(129);
	let n = t.textContent || "";
	if (function(e) {
		let t, n = e.parentNode, r = [e];
		for (; n !== null && (t = xa.get(n)) === void 0 && !Sa(n);) r.push(n), n = n.parentNode;
		let i = t === void 0 ? n : t;
		for (let e = 0; e < r.length; e++) xa.set(r[e], i);
		return i;
	}(t) !== null) return { node: bo(n) };
	if (n = n.replace(/\r/g, "").replace(/[ \t\n]+/g, " "), n === "") return { node: null };
	if (n[0] === " ") {
		let e = t, r = !0;
		for (; e !== null && (e = wa(e, !1)) !== null;) {
			let t = e.textContent || "";
			if (t.length > 0) {
				/[ \t\n]$/.test(t) && (n = n.slice(1)), r = !1;
				break;
			}
		}
		r && (n = n.slice(1));
	}
	if (n[n.length - 1] === " ") {
		let e = t, r = !0;
		for (; e !== null && (e = wa(e, !0)) !== null;) if ((e.textContent || "").replace(/^( |\t|\r?\n)+/, "").length > 0) {
			r = !1;
			break;
		}
		r && (n = n.slice(0, n.length - 1));
	}
	return n === "" ? { node: null } : { node: Da(n) };
}
function wa(e, t) {
	let n = e;
	for (;;) {
		let e;
		for (; (e = t ? n.nextSibling : n.previousSibling) === null;) {
			let e = n.parentElement;
			if (e === null) return null;
			n = e;
		}
		if (n = e, W(n)) {
			let e = n.style.display;
			if (e === "" && !zl(n) || e !== "" && !e.startsWith("inline")) return null;
		}
		let r = n;
		for (; (r = t ? n.firstChild : n.lastChild) !== null;) n = r;
		if (_c(n)) return n;
		if (n.nodeName === "BR") return null;
	}
}
var Ta = {
	code: "code",
	em: "italic",
	i: "italic",
	mark: "highlight",
	s: "strikethrough",
	strong: "bold",
	sub: "subscript",
	sup: "superscript",
	u: "underline"
};
function Ea(e) {
	let t = Ta[e.nodeName.toLowerCase()];
	return t === void 0 ? { node: null } : {
		forChild: Oa(e.style, t),
		node: null
	};
}
function Da(e = "") {
	return ml(new va(e));
}
function N(e) {
	return e instanceof va;
}
function Oa(e, t) {
	let n = e.fontWeight, r = e.textDecoration.split(" "), i = n === "700" || n === "bold", a = r.includes("line-through"), o = e.fontStyle === "italic", s = r.includes("underline"), c = e.verticalAlign, l = e.textTransform;
	return (e) => N(e) || _a(e) ? (i && !e.hasFormat("bold") && e.toggleFormat("bold"), a && !e.hasFormat("strikethrough") && e.toggleFormat("strikethrough"), o && !e.hasFormat("italic") && e.toggleFormat("italic"), s && !e.hasFormat("underline") && e.toggleFormat("underline"), c !== "sub" || e.hasFormat("subscript") || e.toggleFormat("subscript"), c !== "super" || e.hasFormat("superscript") || e.toggleFormat("superscript"), l !== "lowercase" && l !== "uppercase" && l !== "capitalize" || e.hasFormat(l) || e.toggleFormat(l), t && !e.hasFormat(t) && e.toggleFormat(t), e) : e;
}
var ka = /* @__PURE__ */ Pt()({
	detail: /* @__PURE__ */ Lt(/* @__PURE__ */ Mt(2), {
		getter: { field: "__detail" },
		setter: null
	}),
	mode: /* @__PURE__ */ Lt(/* @__PURE__ */ Nt(["normal"]), {
		getter: {
			field: "__mode",
			getterTable: { 0: "normal" }
		},
		setter: null
	}),
	text: /* @__PURE__ */ Lt(/* @__PURE__ */ At("	"), {
		getter: {
			field: "__text",
			method: "getTextContent"
		},
		setter: null
	})
}), Aa = class extends va {
	$config() {
		return this.config("tab", {
			extends: va,
			generated: oa,
			json: ka
		});
	}
	constructor(e = void 0) {
		super("	", e), this.__detail = 2;
	}
	createDOM(e) {
		let t = super.createDOM(e), n = Jc(e.theme, "tab");
		return n !== void 0 && t.classList.add(...n), t;
	}
	setTextContent(e) {
		return super.setTextContent("	");
	}
	spliceText(e, t, n, r) {
		return n === "" && t === 0 || n === "	" && t === 1 || T(286), this;
	}
	setDetail(e) {
		return e !== 2 && T(127), this;
	}
	setMode(e) {
		return e !== "normal" && T(128), this;
	}
	canInsertTextBefore() {
		return !1;
	}
	canInsertTextAfter() {
		return !1;
	}
};
function ja() {
	return ml(new Aa());
}
function Ma(e) {
	return e instanceof Aa;
}
var Na = class {
	key;
	offset;
	type;
	_selection;
	constructor(e, t, n) {
		this._selection = null, this.key = e, this.offset = t, this.type = n;
	}
	is(e) {
		return this.key === e.key && this.offset === e.offset && this.type === e.type;
	}
	isBefore(e) {
		return this.key === e.key ? this.offset < e.offset : wd(Is(Ds(this, "next")), Is(Ds(e, "next"))) < 0;
	}
	getNode() {
		let e = H(this.key);
		return e === null && T(20), e;
	}
	set(e, t, n, r) {
		let i = this._selection, a = this.key;
		r && this.key === e && this.offset === t && this.type === n || (this.key = e, this.offset = t, this.type = n, Io() || (Tc() === a && wc(e), i !== null && (i.setCachedNodes(null), P(i) && (i._cachedIsBackward = null), i.dirty = !0)));
	}
};
function Pa(e, t, n) {
	return new Na(e, t, n);
}
function Fa(e, t) {
	let n = t.__key, r = e.offset, i = "element";
	if (N(t)) {
		i = "text";
		let e = t.getTextContentSize();
		r > e && (r = e);
	} else if (!B(t)) {
		let e = t.getNextSibling();
		if (N(e)) n = e.__key, r = 0, i = "text";
		else {
			let e = t.getParent();
			e && (n = e.__key, r = t.getIndexWithinParent() + 1);
		}
	}
	e.set(n, r, i);
}
function Ia(e, t) {
	if (B(t)) {
		let n = t.getLastDescendant();
		B(n) || N(n) ? Fa(e, n) : Fa(e, t);
	} else Fa(e, t);
}
function La(e, t, n, r) {
	let i = e.getNode(), a = i.getChildAtIndex(e.offset), o = Da();
	if (o.setFormat(n), o.setStyle(r), Js(a)) a.splice(0, 0, [o]);
	else if (a !== null) {
		let e = fl(i) ? qs().append(o) : o;
		a.insertBefore(e);
	} else if (fl(i)) {
		let e = i.getLastChild();
		B(e) && !e.isInline() && e.isEmpty() ? e.append(o) : i.append(qs().append(o));
	} else i.append(o);
	e.is(t) && t.set(o.__key, 0, "text"), e.set(o.__key, 0, "text");
}
function Ra(e, t, n, r) {
	let i = e.anchor.getNode();
	N(i) || T(398);
	let a = e.anchor.offset, o = Da(t);
	o.setFormat(n), o.setStyle(r);
	let s = i.getParentOrThrow();
	if (a === 0) s.isInline() && !i.__prev ? s.insertBefore(o) : i.insertBefore(o, !1);
	else if (a === i.getTextContentSize()) s.isInline() && !i.__next ? s.insertAfter(o) : i.insertAfter(o, !1);
	else {
		let [e] = i.splitText(a);
		e.insertAfter(o, !1);
	}
	i.getTextContent() === "" && i.isAttached() && i.remove(), o.selectEnd(), o.isComposing() && e.anchor.type === "text" && e.anchor.set(e.anchor.key, e.anchor.offset - t.length, e.anchor.type);
}
var za = class e {
	_nodes;
	_cachedNodes;
	dirty;
	constructor(e) {
		this._cachedNodes = null, this._nodes = e, this.dirty = !1;
	}
	getCachedNodes() {
		return this._cachedNodes;
	}
	setCachedNodes(e) {
		this._cachedNodes = e;
	}
	is(e) {
		if (!Ha(e)) return !1;
		let t = this._nodes, n = e._nodes;
		return t.size === n.size && Array.from(t).every((e) => n.has(e));
	}
	isCollapsed() {
		return !1;
	}
	isBackward() {
		return !1;
	}
	getStartEndPoints() {
		return null;
	}
	add(e) {
		this.dirty = !0, this._nodes.add(e), this._cachedNodes = null;
	}
	delete(e) {
		this.dirty = !0, this._nodes.delete(e), this._cachedNodes = null;
	}
	clear() {
		this.dirty = !0, this._nodes.clear(), this._cachedNodes = null;
	}
	has(e) {
		return this._nodes.has(e);
	}
	clone() {
		return new e(new Set(this._nodes));
	}
	extract() {
		return this.getNodes();
	}
	insertRawText(e) {}
	insertText() {}
	insertNodes(e) {
		let t = this.getNodes().filter((e) => Pu(e) === null), n = t.length;
		if (n === 0) return;
		let r = t[n - 1], i;
		if (N(r)) i = r.select();
		else {
			let e = r.getIndexWithinParent() + 1;
			i = r.getParentOrThrow().select(e, e);
		}
		i.insertNodes(e);
		for (let e = 0; e < n; e++) t[e].remove();
	}
	getNodes() {
		let e = this._cachedNodes;
		if (e !== null) return e;
		let t = this._nodes, n = [];
		for (let e of t) {
			let t = H(e);
			t !== null && n.push(t);
		}
		return Io() || (this._cachedNodes = n), n;
	}
	getTextContent() {
		let e = this.getNodes(), t = "";
		for (let n = 0; n < e.length; n++) t += e[n].getTextContent();
		return t;
	}
	deleteNodes() {
		let e = this.getNodes().filter((e) => Pu(e) === null);
		if ((F() || po()) === this && e[0]) {
			let t = dd(e[0], "next");
			ks(Sd(t, t));
		}
		for (let t of e) t.remove();
		Ba();
	}
};
function Ba() {
	let e = Mc();
	if (e.getChildrenSize() === 0 && Ru(F()) === null) {
		let t = qs();
		e.append(t), t.select();
	}
}
function P(e) {
	return e instanceof Va;
}
var Va = class e {
	format;
	style;
	anchor;
	focus;
	_cachedNodes;
	_cachedIsBackward;
	dirty;
	constructor(e, t, n, r) {
		this.anchor = e, this.focus = t, e._selection = this, t._selection = this, this._cachedNodes = null, this._cachedIsBackward = null, this.format = n, this.style = r, this.dirty = !1;
	}
	getCachedNodes() {
		return this._cachedNodes;
	}
	setCachedNodes(e) {
		this._cachedNodes = e;
	}
	is(e) {
		return !!P(e) && this.anchor.is(e.anchor) && this.focus.is(e.focus) && this.format === e.format && this.style === e.style;
	}
	isCollapsed() {
		return this.anchor.is(this.focus);
	}
	getNodes() {
		let e = this._cachedNodes;
		if (e !== null) return e;
		let t = function(e) {
			let t = [], [n, r] = e.getTextSlices();
			n && t.push(n.caret.origin);
			let i = /* @__PURE__ */ new Set(), a = /* @__PURE__ */ new Set();
			for (let n of e) if (sd(n)) {
				let { origin: e } = n;
				t.length === 0 ? i.add(e) : (a.add(e), t.push(e));
			} else {
				let { origin: e } = n;
				B(e) && a.has(e) || t.push(e);
			}
			if (r && t.push(r.caret.origin), od(e.focus) && B(e.focus.origin) && e.focus.getNodeAtCaret() === null) for (let n = hd(e.focus.origin, "previous"); sd(n) && i.has(n.origin) && !n.origin.isEmpty() && n.origin.is(t[t.length - 1]); n = _d(n)) i.delete(n.origin), t.pop();
			for (; t.length > 1;) {
				let e = t[t.length - 1];
				if (!B(e) || a.has(e) || e.isEmpty() || i.has(e)) break;
				t.pop();
			}
			if (t.length === 0 && e.isCollapsed()) {
				let n = Is(e.anchor), r = Is(e.anchor.getFlipped()), i = (e) => ad(e) ? e.origin : e.getNodeAtCaret(), a = i(n) || i(r) || (e.anchor.getNodeAtCaret() ? n.origin : r.origin);
				t.push(a);
			}
			return t;
		}(Rs(js(this), "next"));
		return Io() || (this._cachedNodes = t), t;
	}
	setTextNodeRange(e, t, n, r) {
		return this.anchor.set(e.__key, t, "text"), this.focus.set(n.__key, r, "text"), this;
	}
	getTextContent() {
		let e = this.getNodes();
		if (e.length === 0) return "";
		let t = e[0], n = e[e.length - 1], r = this.anchor, i = this.focus, a = r.isBefore(i), [o, s] = Ka(this), c = "", l = !0;
		for (let u = 0; u < e.length; u++) {
			let d = e[u];
			if (B(d) && !d.isInline()) {
				l || (c += "\n");
				let e = "";
				for (let t of Bu(d)) {
					let n = Vu(d, t);
					n !== null && (e += n.getTextContent());
				}
				e === "" ? l = !d.isEmpty() : (c += e, l = !1);
			} else if (l = !1, N(d)) {
				let e = d.getTextContent();
				d === t ? d === n ? r.type === "element" && i.type === "element" && i.offset !== r.offset || (e = o < s ? e.slice(o, s) : e.slice(s, o)) : e = a ? e.slice(o) : e.slice(s) : d === n && (e = a ? e.slice(0, s) : e.slice(0, o)), c += e;
			} else !V(d) && !Cs(d) || d === n && this.isCollapsed() || (c += d.getTextContent());
		}
		return c;
	}
	applyDOMRange(e) {
		let t = z(), n = t.getEditorState()._selection, r = oo(e.startContainer, e.startOffset, e.endContainer, e.endOffset, t, n);
		if (r === null) return;
		let [i, a, o] = r;
		this.anchor.set(i.key, i.offset, i.type, !0), this.focus.set(a.key, a.offset, a.type, !0), o && (this.dirty = !0), rn(this);
	}
	clone() {
		let t = this.anchor, n = this.focus;
		return new e(Pa(t.key, t.offset, t.type), Pa(n.key, n.offset, n.type), this.format, this.style);
	}
	toggleFormat(e) {
		this.format = bc(this.format, e, null), this.dirty = !0;
	}
	setFormat(e) {
		this.format = e, this.dirty = !0;
	}
	setStyle(e) {
		this.style = e, this.dirty = !0;
	}
	hasFormat(e) {
		let t = ke[e];
		return (this.format & t) !== 0;
	}
	insertRawText(e) {
		this.insertNodes(bo(e));
	}
	insertText(e) {
		let t = this.format, n = this.style;
		if (!this.isCollapsed()) {
			let r = (this.focus.isBefore(this.anchor) ? this.focus : this.anchor).getNode();
			if (N(r) && (t = r.getFormat(), n = r.getStyle()), this.removeText(), this.format = t, this.style = n, e === "") return;
			if (Tc() === null) return this.anchor.type === "element" && La(this.anchor, this.focus, t, n), void Ra(this, e, t, n);
		}
		this.anchor.type === "element" && La(this.anchor, this.focus, t, n);
		let r = this.anchor.getNode();
		N(r) || T(398);
		let i = this.anchor.offset, a = r.getParentOrThrow(), o = r.getTextContentSize();
		if (gc(r) || i === 0 && (!r.canInsertTextBefore() || !a.canInsertTextBefore() && !r.__prev) || i === o && (!r.canInsertTextAfter() || !a.canInsertTextAfter() && !r.__next)) {
			if (r.isSegmented() && i !== 0 && i !== o) {
				if (Tc() !== null) r.setMode("normal").setFormat(t).setStyle(n);
				else {
					let e = Da(r.getTextContent());
					e.setFormat(t), e.setStyle(n);
					let a = F() === this;
					r.replace(e), this.setTextNodeRange(e, i, e, i), a && F() !== this && Pc(this);
				}
				e !== "" && this.insertText(e);
				return;
			}
			if (e === "") return;
			if (i === 0) {
				let i = r.getPreviousSibling();
				if (N(i) && i.canInsertTextAfter() && !gc(i)) i.select();
				else {
					let e = Da();
					e.setFormat(t), e.setStyle(n), a.canInsertTextBefore() ? r.insertBefore(e) : a.insertBefore(e), e.select();
				}
				this.insertText(e);
				return;
			}
			if (i === o) {
				let i = r.getNextSibling();
				if (N(i) && i.canInsertTextBefore() && !gc(i)) i.select(0, 0);
				else {
					let e = Da();
					e.setFormat(t), e.setStyle(n), a.canInsertTextAfter() ? r.insertAfter(e) : a.insertAfter(e), e.select(0, 0);
				}
				this.insertText(e);
				return;
			}
			let s = Da(e);
			s.setFormat(t), s.setStyle(n), r.replace(s), s.select();
			return;
		}
		if (e === "") return;
		let s = a.isInline() && i === 0 && !r.__prev, c = a.isInline() && i === o && !r.__next, l = r.getFormat() !== t || r.getStyle() !== n;
		if (s || c || l) {
			if (r.getTextContent() !== "" || s || c) return void Ra(this, e, t, n);
			r.setFormat(t), r.setStyle(n);
		}
		r.spliceText(i, 0, e, !0), r.isComposing() && this.anchor.type === "text" && this.anchor.set(this.anchor.key, this.anchor.offset - e.length, this.anchor.type);
	}
	removeText() {
		let e = F() === this, t = this.anchor.key;
		As(this, Fs(js(this))), this.isCollapsed() && function(e, t) {
			let n = e.anchor;
			if (n.key === t) return;
			let r = n.getNode(), i = 0, a = "";
			N(r) ? (i = r.getFormat(), a = r.getStyle()) : B(r) && (i = r.getTextFormat(), a = r.getTextStyle()), e.format === i && e.style === a || (e.format = i, e.style = a, e.dirty = !0);
		}(this, t), e && F() !== this && Pc(this);
	}
	formatText(e, t = null) {
		Wa(this, e, t);
	}
	insertNodes(e) {
		if (e.length === 0) return;
		this.isCollapsed() || this.removeText();
		let t = this.anchor.getNode();
		if (this.anchor.type === "element" && B(t) && t.isShadowRoot() && Pu(t) !== null) {
			let n = t.getFirstChild() ?? t.append(qs()).getFirstChild();
			if (n !== null && !B(n)) {
				let e = qs();
				n.insertBefore(e), n = e;
			}
			if (n !== null) {
				n.selectStart();
				let t = F();
				return P(t) || T(369), t.insertNodes(e);
			}
		}
		if (this.anchor.type === "element" && fl(t)) {
			let n = To(e), r = n.getLastDescendant();
			t.splice(this.anchor.offset, 0, n.getChildren()), r !== null && r.selectEnd();
			return;
		}
		let n = this.isBackward() ? this.focus : this.anchor, r = n.getNode(), i = Ou(r, q), a = e[e.length - 1];
		if (B(i) && "__language" in i) {
			if ("__language" in e[0]) this.insertText(e[0].getTextContent());
			else {
				let [, t] = So(this);
				i.splice(t, 0, e), a.selectEnd();
			}
			return;
		}
		if (!e.some((e) => (B(e) || V(e)) && !e.isInline())) {
			B(i) || T(211, r.constructor.name, r.getType());
			let [t, n] = So(this, !0);
			(B(t) ? t : i).splice(n, 0, e), a.selectEnd();
			return;
		}
		if (B(i) && Pu(i) !== null) {
			let [, t] = So(this), n = xo(e);
			i.splice(t, 0, n);
			let r = n[n.length - 1];
			r === void 0 ? i.select(t, t) : r.selectEnd();
			return;
		}
		if (i === null) {
			let t = To(e), n = t.getLastDescendant(), r = Ds(this.anchor, "next");
			for (let e of t.getChildren()) r = Us(e, r);
			n !== null && n.selectEnd();
			return;
		}
		if (B(i) && !i.isParentRequired() && !fl(i.getParentOrThrow())) {
			let [, t] = So(this), n = xo(e);
			i.splice(t, 0, n);
			let r = n[n.length - 1];
			r === void 0 ? i.select(t, t) : r.selectEnd();
			return;
		}
		let o = To(e), s = o.getLastDescendant(), c = o.getChildren(), l = function(e) {
			let t = function(e) {
				let t = e.getNode();
				if (e.offset > 0) return e.type === "element" && B(t) ? t.getChildAtIndex(e.offset - 1) : null;
				for (let e = t; e !== null && !q(e) && !fl(e); e = e.getParent()) {
					let t = e.getPreviousSibling();
					if (t !== null) return t;
				}
				return null;
			}(e);
			return Cs(t) && Cs(t.getPreviousSibling());
		}(n), u = B(i) && i.isEmpty() ? null : this.insertParagraph();
		u && !i.isAttached() && (r = this.anchor.getNode(), i = Ou(r, q));
		let d = c[c.length - 1], f = c[0];
		var p = f;
		l || !B(p) || !q(p) || p.isEmpty() || !B(i) || i.isEmpty() && !i.canMergeWhenEmpty() || (B(i) || T(211, r.constructor.name, r.getType()), i.append(...f.getChildren()), f = c[1]), f && (i === null && T(212, r.constructor.name, r.getType()), function(e, t) {
			let n = t.getParentOrThrow().getLastChild(), r = t, i = [t];
			for (; r !== n;) r.getNextSibling() || T(140), r = r.getNextSibling(), i.push(r);
			let a = e;
			for (let e of i) a = a.insertAfter(e);
		}(i, f));
		let m = Ou(s, q), h = s.selectEnd();
		u && (B(m) && (u.canMergeWhenEmpty() || q(d)) ? (m.append(...u.getChildren()), u.remove()) : u.isEmpty() && u.remove()), B(i) && i.isEmpty() && i.remove();
		let g = B(i) ? i.getLastChild() : null;
		Cs(g) && m !== i && g.remove();
		let _ = Is(Ds(h.anchor, "next"));
		Os(h.anchor, _), Os(h.focus, _);
	}
	insertParagraph() {
		this.isCollapsed() || this.removeText();
		let e = this.anchor.getNode();
		if (this.anchor.type === "element" && fl(e)) {
			let t = qs();
			return e.splice(this.anchor.offset, 0, [t]), t.select(), t;
		}
		let [, t] = So(this), n = Ou(this.anchor.getNode(), q);
		if (n !== null && Pu(n) !== null) return null;
		B(n) || T(213);
		let r = n.getChildAtIndex(t), i = r ? [r, ...r.getNextSiblings()] : [], a = n.insertNewAfter(this, !1);
		return a ? (a.append(...i), a.selectStart(), a) : null;
	}
	insertLineBreak(e) {
		let t = Ss();
		if (this.insertNodes([t]), e) {
			let e = t.getParentOrThrow(), n = t.getIndexWithinParent();
			e.select(n, n);
		}
	}
	extract() {
		let e = [...this.getNodes()], t = e.length, n = e[0], r = e[t - 1], [i, a] = Ka(this), o = this.isBackward(), [s, c] = o ? [this.focus, this.anchor] : [this.anchor, this.focus], [l, u] = o ? [a, i] : [i, a];
		if (t === 0) return [];
		if (t === 1) {
			if (N(n) && !this.isCollapsed()) {
				let e = n.splitText(l, u), t = l === 0 ? e[0] : e[1];
				return t ? (s.set(t.getKey(), 0, "text"), c.set(t.getKey(), t.getTextContentSize(), "text"), [t]) : [];
			}
			return [n];
		}
		if (N(n) && (l === n.getTextContentSize() ? e.shift() : l !== 0 && ([, n] = n.splitText(l), e[0] = n, s.set(n.getKey(), 0, "text"))), N(r)) {
			let t = r.getTextContent().length;
			u === 0 ? e.pop() : u !== t && ([r] = r.splitText(u), e[e.length - 1] = r, c.set(r.getKey(), r.getTextContentSize(), "text"));
		}
		return e;
	}
	modify(e, t, n) {
		if (Eo(this, e, t, n)) return;
		let r = e === "move", i = z(), a = yl(cl(i));
		if (!a) return;
		let o = i._blockCursorElement, s = i._rootElement, c = this.focus.getNode();
		s === null || o === null || !B(c) || c.isInline() || c.canBeEmpty() || vl(o, i, s);
		let l = $c(i, this.focus.key), u = l;
		if (this.focus.type === "text" && (u = N(c) ? Hl(c, l, i) : null), this.dirty) {
			let e = $c(i, this.anchor.key), t = e;
			if (this.anchor.type === "text") {
				let n = this.anchor.getNode();
				t = N(n) ? Hl(n, e, i) : null;
			}
			t && u && R(a, t, this.anchor.offset, u, this.focus.offset);
		}
		if (n === "character" && N(c) && c.isUnmergeable() && (t ? this.focus.offset === 0 : this.focus.offset === c.getTextContentSize())) {
			let e = dd(c, t ? "previous" : "next").getNodeAtCaret();
			if (N(e)) {
				if (!r) {
					let n = e.getTextContentSize();
					t ? this.focus.set(e.__key, n - 1, "text") : this.focus.set(e.__key, 1, "text"), this.dirty = !0;
					return;
				}
				{
					let n = i.getElementByKey(e.getKey()), r = n ? Hl(e, n, i) : null;
					if (r) {
						let e = t ? r.length : 0;
						R(a, r, e, r, e);
					}
				}
			}
		}
		if (Ya(a, e, t ? "backward" : "forward", n, s), a.rangeCount > 0) {
			let e = Dl(a, i._rootElement), n = e || a.getRangeAt(0), o = this.anchor.getNode(), s = ps(o) ? o : ul(o);
			this.applyDOMRange(n), this.dirty = !0, r || (Xa(this, t, s), (e ? a.direction !== "backward" : a.anchorNode === n.startContainer && a.anchorOffset === n.startOffset) || Ja(this));
		}
		n === "lineboundary" && Eo(this, e, t, n, "decorators");
	}
	forwardDeletion(e, t, n) {
		if (!n && (e.type === "element" && B(t) && e.offset === t.getChildrenSize() || e.type === "text" && e.offset === t.getTextContentSize())) {
			let e = t.getParent(), n = t.getNextSibling() || (e === null ? null : e.getNextSibling());
			if (B(n) && n.isShadowRoot()) return !0;
		}
		return !1;
	}
	deleteCharacter(e) {
		let t = this.isCollapsed();
		if (this.isCollapsed()) {
			let t = this.anchor, n = t.getNode();
			if (this.forwardDeletion(t, n, e)) {
				let e = B(n) ? n.getNextSibling() : null;
				if (!(B(n) && n.isEmpty() && B(e) && e.isShadowRoot())) return;
			}
			let r = Ds(t, e ? "previous" : "next"), i = Z(r);
			if (i.getTextSlices().every((e) => e === null || e.distance === 0)) {
				if (t.type === "element") {
					let e = r.getNodeAtCaret();
					if (B(e) && _l(e)) {
						let t = e.getParent();
						e.remove();
						let n = Nc(t, e);
						n !== null && n.selectStart();
						return;
					}
				}
				let e = { type: "initial" };
				for (let t of i.iterNodeCarets("shadowRoot")) if (sd(t)) {
					if (!t.origin.isInline()) {
						if (t.origin.isShadowRoot()) {
							if (e.type === "merge-block") break;
							if (B(i.anchor.origin) && i.anchor.origin.isEmpty()) {
								let e = Is(t);
								As(this, Sd(e, e)), i.anchor.origin.remove();
							}
							return;
						}
						e.type !== "merge-next-block" && e.type !== "merge-block" || (e = {
							block: e.block,
							caret: t,
							type: "merge-block"
						});
					}
				} else {
					if (e.type === "merge-block") break;
					if (od(t)) {
						if (B(t.origin)) {
							if (t.origin.isInline()) {
								if (!t.origin.isParentOf(i.anchor.origin)) break;
							} else e = {
								block: t.origin,
								type: "merge-next-block"
							};
							continue;
						}
						if (V(t.origin)) {
							if (!t.origin.isIsolated()) {
								if (e.type === "merge-next-block" && (t.origin.isKeyboardSelectable() || !t.origin.isInline()) && B(i.anchor.origin) && i.anchor.origin.isEmpty()) {
									i.anchor.origin.remove();
									let e = uo();
									e.add(t.origin.getKey()), Pc(e);
								} else {
									let e = t.origin, n = e.getParent();
									e.remove();
									let r = Nc(n, e);
									r !== null && r.selectStart();
								}
							}
							return;
						}
						if (Cs(t.origin)) return void t.origin.remove();
						break;
					}
				}
				if (e.type === "merge-block") {
					let { caret: t, block: n } = e;
					return Bu(n).length > 0 ? void 0 : t.origin.isEmpty() && !n.isEmpty() && t.origin.getParent() === n.getParent() ? void t.origin.remove(!0) : (As(this, Sd(!t.origin.isEmpty() && n.isEmpty() ? Ms(dd(n, t.direction)) : i.anchor, t)), this.removeText());
				}
				for (let e = t.getNode(); e !== null;) {
					if (Pu(e) !== null) return;
					if (B(e) && e.isShadowRoot()) break;
					e = e.getParent();
				}
			}
			let a = this.focus;
			if (Za(this, e, "character"), this.isCollapsed()) {
				if (e && t.offset === 0 && function(e, t) {
					for (let n = t; n; n = n.getParent()) {
						if (B(n)) {
							if (n.collapseAtStart(e)) return !0;
							if (fl(n)) break;
						}
						if (n.getPreviousSibling()) break;
					}
					return !1;
				}(this, t.getNode())) return;
			} else {
				let r = a.type === "text" ? a.getNode() : null;
				if (n = t.type === "text" ? t.getNode() : null, r !== null && r.isSegmented()) {
					let t = a.offset, i = r.getTextContentSize();
					if (r.is(n) || e && t !== i || !e && t !== 0) return void eo(r, e, t);
				} else if (n !== null && n.isSegmented()) {
					let i = t.offset, a = n.getTextContentSize();
					if (n.is(r) || e && i !== 0 || !e && i !== a) return void eo(n, e, i);
				}
				(function(e, t) {
					let n = e.anchor, r = e.focus, i = n.getNode();
					if (i === r.getNode() && n.type === "text" && r.type === "text") {
						let e = n.offset, o = r.offset, s = e < o, c = s ? e : o, l = s ? o : e, u = l - 1;
						c !== u && !Lc(a = i.getTextContent().slice(c, l)) && !$a(a) && (t ? r.set(r.key, u, r.type) : n.set(n.key, u, n.type));
					}
					var a;
				})(this, e);
			}
		}
		t || qa(this), this.removeText(), e && !t && this.isCollapsed() && this.anchor.type === "element" && this.anchor.offset === 0 && Ba();
	}
	deleteLine(e) {
		let t = this.isCollapsed(), n = ro(this.anchor);
		if (n !== null && V(Fu(n))) return this.isCollapsed() || this.focus.set(this.anchor.key, this.anchor.offset, this.anchor.type), void this.deleteCharacter(e);
		this.isCollapsed() && Za(this, e, "lineboundary"), this.isCollapsed() ? this.deleteCharacter(e) : Ou(this.anchor.getNode(), q) === Ou(this.focus.getNode(), q) ? (t || qa(this), this.removeText()) : (this.focus.set(this.anchor.key, this.anchor.offset, this.anchor.type), this.deleteCharacter(e));
	}
	deleteWord(e) {
		let t = this.isCollapsed();
		if (this.isCollapsed()) {
			let t = this.anchor, n = t.getNode();
			if (this.forwardDeletion(t, n, e)) return;
			Za(this, e, "word");
		}
		this.isCollapsed() ? this.deleteCharacter(e) : (t || qa(this), this.removeText());
	}
	isBackward() {
		let e = this._cachedIsBackward;
		if (e !== null) return e;
		let t = this.focus.isBefore(this.anchor);
		return Io() || (this._cachedIsBackward = t), t;
	}
	getStartEndPoints() {
		return [this.anchor, this.focus];
	}
};
function Ha(e) {
	return e instanceof za;
}
function Ua(e, t) {
	if (Ha(e)) {
		for (let n of e.getNodes()) _a(n) && n.setFormat(t(n.getFormat()));
		return;
	}
	if (e.isCollapsed()) return e.setFormat(t(e.format)), void wc(null);
	let n = [];
	for (let r of e.getNodes()) N(r) ? n.push(r) : B(r) ? r.setTextFormat(t(r.getTextFormat())) : _a(r) && r.setFormat(t(r.getFormat()));
	let r = n.length;
	if (r === 0) return e.setFormat(t(e.format)), void wc(null);
	let i = e.anchor, a = e.focus, o = e.isBackward(), s = o ? a : i, c = o ? i : a, l = 0, u = n[0], d = s.type === "element" ? 0 : s.offset;
	if (s.type === "text" && d === u.getTextContentSize() && (l = 1, u = n[1], d = 0), u == null) return;
	let f = r - 1, p = n[f], m = c.type === "text" ? c.offset : p.getTextContentSize();
	if (u.is(p)) {
		if (d === m) return;
		let n = t(u.getFormat());
		if (gc(u) || d === 0 && m === u.getTextContentSize()) u.setFormat(n);
		else {
			let e = u.splitText(d, m), t = d === 0 ? e[0] : e[1];
			t.setFormat(n), s.type === "text" && s.set(t.__key, 0, "text"), c.type === "text" && c.set(t.__key, m - d, "text");
		}
		e.format = n;
		return;
	}
	d === 0 || gc(u) || ([, u] = u.splitText(d), d = 0);
	let h = t(u.getFormat());
	u.setFormat(h);
	let g = t(p.getFormat());
	m > 0 && (m === p.getTextContentSize() || gc(p) || ([p] = p.splitText(m)), p.setFormat(g));
	for (let e = l + 1; e < f; e++) {
		let r = n[e];
		r.setFormat(t(r.getFormat()));
	}
	s.type === "text" && s.set(u.__key, d, "text"), c.type === "text" && c.set(p.__key, m, "text"), e.format = h | g;
}
function Wa(e, t, n = null) {
	let r = n === null && P(e) ? bc(e.format, t, null) : n;
	Ua(e, (e) => bc(e, t, r));
}
function Ga(e) {
	let t = e.offset;
	if (e.type === "text") return t;
	let n = e.getNode();
	return t === n.getChildrenSize() ? n.getTextContent().length : 0;
}
function Ka(e) {
	let t = e.getStartEndPoints();
	if (t === null) return [0, 0];
	let [n, r] = t;
	return n.type === "element" && r.type === "element" && n.key === r.key && n.offset === r.offset ? [0, 0] : [Ga(n), Ga(r)];
}
function qa(e) {
	let t = Mc();
	!t.isEmpty() && Ws(t, e) && (e.anchor.set(t.getKey(), 0, "element"), e.focus.set(t.getKey(), t.getChildrenSize(), "element"));
}
function Ja(e) {
	let t = e.focus, n = e.anchor, r = n.key, i = n.offset, a = n.type;
	n.set(t.key, t.offset, t.type, !0), t.set(r, i, a, !0);
}
function Ya(e, t, n, r, i) {
	let a = r === "character" ? kl(e, i) : null, o = a && a.focusNode, s = a ? a.focusOffset : 0;
	if (e.modify(t, n, r), a === null || !function(e, t, n) {
		return e !== null && e.nodeType === 3 && (n === "backward" ? t > 0 : n === "forward" && t < e.length);
	}(o, s, n)) return;
	let c = kl(e, i);
	c.focusNode === o && c.focusOffset === s && e.modify(t, n, r);
}
function Xa(e, t, n) {
	let r = e.getNodes(), i = r.filter((e) => ol(e, n));
	if (i.length === 0 || i.length === r.length) return !1;
	let a = t ? i[0] : i[i.length - 1], o = B(a) ? a : a.getParentOrThrow();
	return t ? o.selectStart() : o.selectEnd(), !0;
}
function Za(e, t, n) {
	if (Eo(e, "extend", t, n)) return;
	let r = z(), i = yl(cl(r));
	if (!i || typeof i.modify != "function") return;
	let a = r._blockCursorElement, o = r._rootElement, s = e.anchor, c = e.focus.getNode();
	o === null || a === null || !B(c) || c.isInline() || c.canBeEmpty() || vl(a, r, o);
	let l = (e) => {
		let t = e.getNode(), n = r.getElementByKey(e.key);
		return n !== null && e.type === "text" && N(t) ? Hl(t, n, r) : n;
	}, u = s.getNode(), d = l(s);
	if (d === null) return;
	let f = s.offset, p = e.isCollapsed(), m = e.focus, h = p ? d : l(m);
	if (h === null) return;
	let g = m.offset;
	if (R(i, h, g, h, g), Ya(i, "move", t ? "backward" : "forward", n, o), i.rangeCount === 0) return;
	let _ = Dl(i, o) || i.getRangeAt(0), v = _.startContainer, y = _.startOffset;
	if (n === "lineboundary" && _c(v) && pc(v) === r) {
		let e = Ic(v);
		if (V(e) && e.isInline() && !e.isIsolated()) {
			let n = r.getElementByKey(e.getKey());
			n !== null && n.contains(v) && (v = n, y = t ? 0 : n.childNodes.length);
		}
	}
	if (p && n === "character" && s.type === "text" && N(u) && u.isUnmergeable() && f === (t ? 0 : u.getTextContentSize())) {
		let n = dd(u, t ? "previous" : "next").getNodeAtCaret();
		if (N(n)) {
			let r = t ? n.getTextContentSize() - 1 : 1;
			e.focus.set(n.__key, r, "text"), e.dirty = !0;
			return;
		}
	}
	if (p && n === "character" && s.type === "text") {
		let n = t ? 0 : u.getTextContentSize(), r = v === d ? y : f === n ? -1 : n;
		if (r >= 0) return void (r !== f && (e.focus.set(s.key, r, "text"), e.dirty = !0));
	}
	let [b, x, S, C] = t ? [
		v,
		y,
		d,
		f
	] : [
		d,
		f,
		v,
		y
	], w = ps(u) ? u : ul(u);
	e.applyDOMRange({
		collapsed: !1,
		endContainer: S,
		endOffset: C,
		startContainer: b,
		startOffset: x
	}), e.dirty = !0, !Xa(e, t, w) && t && Ja(e), n === "lineboundary" && Eo(e, "extend", t, n, "decorators");
}
function Qa() {
	try {
		let e = /* @__PURE__ */ RegExp("\\p{Emoji}", "u"), t = e.test.bind(e);
		if (t("❤️") && t("#️⃣") && t("👍")) return t;
	} catch {}
	return () => !1;
}
var $a = /* @__PURE__ */ Qa();
function eo(e, t, n) {
	let r = e, i = r.getTextContent().split(/(?=\s)/g), a = i.length, o = 0, s = 0;
	for (let e = 0; e < a; e++) {
		let r = e === a - 1;
		if (s = o, o += i[e].length, t && o === n || o > n || r) {
			i.splice(e, 1), r && (s = void 0);
			break;
		}
	}
	let c = i.join("").trim();
	c === "" ? r.remove() : (r.setTextContent(c), r.select(s, s));
}
function to(e, t, n, r) {
	let i, a = t, o = !1;
	if (W(e)) {
		let s = !1, c = e.childNodes, l = c.length, u = r._blockCursorElement;
		a === l && l > 0 && (s = !0, a = l - 1), Oc(e, r) !== void 0 || eu(e, r) || (o = !0);
		let d = c[a], f = !1;
		if (d === u) d = c[a + 1], f = !0;
		else if (u !== null) {
			let n = u.parentNode;
			e === n && t > Array.prototype.indexOf.call(n.children, u) && a--;
		}
		if (i = Ic(d), N(i)) a = pd(i, s ? "next" : "previous");
		else {
			let c = Ic(e);
			if (c === null) return null;
			if (B(c)) {
				let o = r.getElementByKey(c.getKey());
				o === null && T(214);
				let l = Bl(c, o, r);
				[c, a] = l.resolveChildIndex(c, o, e, t), B(c) || T(215), s && a >= c.getChildrenSize() && (a = Math.max(0, c.getChildrenSize() - 1));
				let u = c.getChildAtIndex(a);
				if (B(u) && function(e, t, n) {
					let r = e.getParent();
					return n === null || r === null || !r.canBeEmpty() || r !== n.getNode();
				}(u, 0, n)) {
					let e = s ? u.getLastDescendant() : u.getFirstDescendant();
					e === null ? c = u : (u = e, c = B(u) ? u : u.getParentOrThrow()), a = 0;
				}
				N(u) ? (i = u, c = null, a = pd(u, s ? "next" : "previous")) : u !== c && s && !f && (B(c) || T(216), a = Math.min(c.getChildrenSize(), a + 1));
			} else {
				let n = Fu(c), i = n === null ? c : n, o = i.getIndexWithinParent(), s = r.getElementByKey(c.getKey()), l = "after";
				if (s !== null && Ic(e) === c) {
					let n = Bl(c, s, r);
					n.element === s ? t === 0 && V(c) && (l = "before") : l = n.resolveLeafPosition(s, e, t);
				}
				a = l === "before" ? o : o + 1, c = i.getParentOrThrow();
			}
			if (B(c)) return [Pa(c.__key, a, "element"), o];
		}
	} else i = Ic(e);
	return N(i) ? [Pa(i.__key, pd(i, a, "clamp"), "text"), o] : null;
}
function no(e, t, n) {
	let r = e.offset, i = e.getNode();
	if (r === 0) {
		let r = i.getPreviousSibling(), a = i.getParent();
		if (t) {
			if ((n || !t) && r === null && B(a) && a.isInline()) {
				let t = a.getPreviousSibling();
				N(t) && e.set(t.__key, t.getTextContent().length, "text");
			}
		} else B(r) && !n && r.isInline() ? e.set(r.__key, r.getChildrenSize(), "element") : N(r) && !i.isUnmergeable() && e.set(r.__key, r.getTextContent().length, "text");
	} else if (r === i.getTextContent().length) {
		let r = i.getNextSibling(), a = i.getParent();
		if (t && B(r) && r.isInline()) e.set(r.__key, 0, "element");
		else if ((n || t) && r === null && B(a) && a.isInline() && !a.canInsertTextAfter() && a.getTextContentSize() > 1) {
			let t = a.getNextSibling();
			N(t) && e.set(t.__key, 0, "text");
		}
	}
}
function ro(e) {
	let t = H(e.key);
	return t === null ? null : Lu(t);
}
function io(e, t, n) {
	let r = ro(e), i = ro(t);
	if (r === i || r !== null && i !== null && r.is(i)) return !1;
	let a = n(r, i);
	if (r !== null) return B(r) ? t.set(r.getKey(), a ? r.getChildrenSize() : 0, "element") : t.set(r.getKey(), a ? r.getTextContentSize() : 0, "text"), !0;
	let o = Fu(i);
	if (o === null) return !1;
	let s = o.getParent();
	if (s === null) return !1;
	let c = o.getIndexWithinParent();
	return t.set(s.getKey(), a ? c + 1 : c, "element"), !0;
}
function ao(e) {
	let t = io(e.anchor, e.focus, (t, n) => function(e, t, n, r) {
		if (n !== null && r !== null) {
			let e = Fu(n), t = Fu(r);
			if (e !== null && e.is(t)) {
				for (let t of zu(e).values()) {
					if (t === n.getKey()) return !0;
					if (t === r.getKey()) return !1;
				}
				return !0;
			}
			return e === null || t === null || e.isBefore(t);
		}
		if (n !== null) {
			let e = Fu(n), r = H(t.key);
			return e === null || r === null || !(!e.is(r) && !e.isParentOf(r)) || e.isBefore(r);
		}
		let i = Fu(r), a = H(e.key);
		return i !== null && a !== null && !i.is(a) && !i.isParentOf(a) && a.isBefore(i);
	}(e.anchor, e.focus, t, n));
	return t && (e.dirty = !0), t;
}
function oo(e, t, n, r, i, a) {
	if (e === null || n === null || !dc(i, e, n)) return null;
	let o = to(e, t, P(a) ? a.anchor : null, i);
	if (o === null) return null;
	let s = to(n, r, P(a) ? a.focus : null, i);
	if (s === null) return null;
	let [c, l] = o, [u, d] = s;
	if (c.type === "element" && u.type === "element") {
		let t = Ic(e), r = Ic(n);
		if (V(t) && V(r)) return null;
	}
	let f = i._slotsUsed && io(c, u, () => (e.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
	return function(e, t) {
		if (e.type === "text" && t.type === "text") {
			let n = e.isBefore(t), r = e.is(t);
			no(e, n, r), no(t, !n, r), r && t.set(e.key, e.offset, e.type);
		}
	}(c, u), [
		c,
		u,
		l || d || f
	];
}
function so(e) {
	return B(e) && !e.isInline();
}
function co(e, t, n, r, i, a) {
	let o = zo(), s = new Va(Pa(e, t, i), Pa(n, r, a), 0, "");
	return s.dirty = !0, o._selection = s, s;
}
function lo() {
	return new Va(Pa("root", 0, "element"), Pa("root", 0, "element"), 0, "");
}
function uo() {
	return new za(/* @__PURE__ */ new Set());
}
function fo(e, t, n, r) {
	let i = n._window;
	if (i === null) return null;
	let a = r || i.event, o = a ? a.type : void 0, s = o === "selectionchange", c = !it && (s || o === "beforeinput" || o === "compositionstart" || o === "compositionend" || o === "click" && a && a.detail === 3 || o === "drop" || o === void 0), l, u, d, f;
	if (P(e) && !c) return e.clone();
	{
		if (t === null) return null;
		let r = kl(t, n._rootElement);
		if (l = r.anchorNode, u = r.focusNode, d = r.anchorOffset, f = r.focusOffset, (s || o === void 0) && P(e) && !dc(n, l, u)) return e.clone();
	}
	let p = oo(l, d, u, f, n, e);
	if (p === null) return null;
	let [m, h, g] = p, _ = 0, v = "";
	if (P(e)) {
		let t = e.anchor;
		if (m.key === t.key) _ = e.format, v = e.style;
		else {
			let e = m.getNode();
			N(e) ? (_ = e.getFormat(), v = e.getStyle()) : B(e) && (_ = e.getTextFormat(), v = e.getTextStyle());
		}
	}
	let y = new Va(m, h, _, v);
	return g && (y.dirty = !0), y;
}
function F() {
	return zo()._selection;
}
function po() {
	return z()._editorState._selection;
}
function mo(e, t) {
	let n = t.__key;
	return e.anchor.key === n || e.focus.key === n;
}
function I(e, t, n, r = 1) {
	if (!mo(e, t)) return;
	let i = e.anchor, a = e.focus, o = t.__key;
	if (e.isCollapsed()) {
		let t = i.offset;
		if (n <= t && r > 0 || n < t && r < 0) {
			let n = Math.max(0, t + r);
			i.set(o, n, "element"), a.set(o, n, "element"), ho(e);
		}
	} else {
		let s = e.isBackward(), c = s ? a : i, l = c.getNode(), u = s ? i : a, d = u.getNode();
		if (t.is(l)) {
			let e = c.offset;
			(n <= e && r > 0 || n < e && r < 0) && c.set(o, Math.max(0, e + r), "element");
		}
		if (t.is(d)) {
			let e = u.offset;
			(n <= e && r > 0 || n < e && r < 0) && u.set(o, Math.max(0, e + r), "element");
		}
	}
	ho(e);
}
function ho(e) {
	let t = e.anchor, n = t.offset, r = e.focus, i = r.offset, a = t.getNode(), o = r.getNode();
	if (e.isCollapsed()) {
		if (!B(a)) return;
		let e = a.getChildrenSize(), i = n >= e, o = i ? a.getChildAtIndex(e - 1) : a.getChildAtIndex(n);
		if (N(o)) {
			let e = 0;
			i && (e = o.getTextContentSize()), t.set(o.__key, e, "text"), r.set(o.__key, e, "text");
		}
		return;
	}
	if (B(a)) {
		let e = a.getChildrenSize(), r = n >= e, i = r ? a.getChildAtIndex(e - 1) : a.getChildAtIndex(n);
		if (N(i)) {
			let e = 0;
			r && (e = i.getTextContentSize()), t.set(i.__key, e, "text");
		}
	}
	if (B(o)) {
		let e = o.getChildrenSize(), t = i >= e, n = t ? o.getChildAtIndex(e - 1) : o.getChildAtIndex(i);
		if (N(n)) {
			let e = 0;
			t && (e = n.getTextContentSize()), r.set(n.__key, e, "text");
		}
	}
}
function go(e, t, n, r, i) {
	let a = null, o = 0, s = null;
	r === null ? i !== null && (a = i.__key, N(i) ? s = "text" : B(i) && (s = "element")) : (a = r.__key, N(r) ? (o = r.getTextContentSize(), s = "text") : B(r) && (o = r.getChildrenSize(), s = "element")), a !== null && s !== null ? e.set(a, o, s) : (o = t.getIndexWithinParent(), o === -1 && (o = n.getChildrenSize()), e.set(n.__key, o, "element"));
}
function L(e, t, n, r, i) {
	e.type === "text" ? e.set(n, e.offset + (t ? 0 : i), "text") : e.offset > r.getIndexWithinParent() && e.set(e.key, e.offset - 1, "element");
}
function R(e, t, n, r, i) {
	try {
		e.setBaseAndExtent(t, n, r, i);
	} catch {}
}
function _o(e, t, n) {
	let r = $c(e, t.getKey());
	if (B(t)) {
		let i = Bl(t, r, e);
		return [i.element, n + i.getFirstChildOffset()];
	}
	return [r, n];
}
function vo(e, t, n, r, i, a) {
	let o = a.getRootNode(), s = vc(o) || xl(o) ? Pl(o) : null;
	if (i.has("collaboration") && s !== a || s !== null && uc(s, s)) return;
	let c = kl(r, a), l;
	if (!P(t)) return void (e !== null && dc(n, c.anchorNode, c.focusNode) && r.removeAllRanges());
	let u = t.anchor, d = t.focus, f = u.getNode(), p = d.getNode(), [m, h] = _o(n, f, u.offset), [g, _] = _o(n, p, d.offset), v = t.format, y = t.style, b = t.isCollapsed(), x = m, S = g, C = !1;
	if (u.type === "text" ? (x = N(f) ? Hl(f, m, n) : null, C = f.getFormat() !== v || f.getStyle() !== y) : P(e) && e.anchor.type === "text" && (C = !0), d.type === "text" && (S = N(p) ? Hl(p, g, n) : null), x !== null && S !== null) {
		if (b && (e === null || C || P(e) && (e.format !== v || e.style !== y)) && function(e, t, n, r, i, a) {
			e._inputState.collapsedSelectionFormat = {
				format: t,
				key: i,
				offset: r,
				style: n,
				timeStamp: a
			};
		}(n, v, y, h, u.key, performance.now()), (r.type !== "Range" || !b) && c.anchorOffset === h && c.focusOffset === _ && c.anchorNode === x && c.focusNode === S) {
			if (s === null || !a.contains(s)) {
				let e = s === null ? null : pc(s);
				e !== null && e !== n || i.has("skip-selection-focus") || a.focus({ preventScroll: !0 });
			}
			if (u.type !== "element") return;
		}
		if (R(r, x, h, S, _), O && t.isCollapsed() && a !== null && !i.has("skip-selection-focus")) {
			let e = Nl(a);
			if (e === null || !a.contains(e)) {
				let e = Pl(a.ownerDocument), t = e === null ? null : pc(e);
				t !== null && t !== n || a.focus({ preventScroll: !0 });
			}
		}
		if (!i.has("skip-scroll-into-view") && t.isCollapsed() && a !== null && a === Nl(a)) {
			let e = P(t) && t.anchor.type === "element" ? function(e, t, n) {
				let r = t.childNodes[n];
				if (!W(r)) return r || null;
				let i = Oc(r, e), a = i === void 0 ? null : H(i);
				return a === null || B(a) ? r : Bl(a, r, e).element;
			}(n, x, h) : (l === void 0 && (l = Ol(r, a)), l);
			if (e !== null) {
				let t;
				if (_c(e)) {
					let n = e.ownerDocument.createRange();
					n.selectNode(e), t = n.getBoundingClientRect();
				} else t = W(e) ? e.getBoundingClientRect() : function(e) {
					let t = e.getBoundingClientRect(), { startContainer: n, startOffset: r } = e;
					if (!e.collapsed || t.width !== 0 || t.height !== 0 || !_c(n) || n.length === 0) return t;
					let i = e.cloneRange();
					return r > 0 ? i.setStart(n, r - 1) : i.setEnd(n, 1), i.getBoundingClientRect();
				}(e);
				(function(e, t, n, r = null) {
					let i = tl(n), a = sl(i);
					if (i === null || a === null) return;
					let o = n.getBoundingClientRect();
					if (t.bottom < o.top) return;
					if (r !== null && t.height > 0) {
						let { left: e, right: i } = t, o = W(r) ? r : el(r);
						for (; o !== null && n.contains(o);) {
							let t = rl(a, o, e, i);
							e -= t, i -= t, o = o === n ? null : el(o);
						}
					}
					let { top: s, bottom: c } = t, l = 0, u = 0, d = n;
					for (; d !== null;) {
						let t = d === i.body;
						if (t) {
							let t = a.visualViewport;
							if (t) {
								let e = t.offsetTop;
								l = e, u = e + t.height;
							} else l = 0, u = cl(e).innerHeight;
							let n = a.getComputedStyle(i.documentElement), r = parseFloat(n.scrollPaddingTop), o = parseFloat(n.scrollPaddingBottom);
							isFinite(r) && (l += r), isFinite(o) && (u -= o);
						} else {
							let e = d === n ? o : d.getBoundingClientRect();
							l = e.top, u = e.bottom;
						}
						let r = 0;
						if (s < l ? r = -(l - s) : c > u && (r = c - u), r !== 0) {
							if (t) a.scrollBy(0, r);
							else {
								let e = d.scrollTop;
								d.scrollTop += r;
								let t = d.scrollTop - e;
								s -= t, c -= t;
							}
						}
						if (t) break;
						d = el(d);
					}
				})(n, t, a, x);
			}
		}
		(function(e, t, n, r, i) {
			let a = e._inputState;
			a.isSelectionChangeFromDOMUpdate = !0, a.selectionChangeFromDOMUpdatePoints = t !== void 0 && n !== void 0 && r !== void 0 && i !== void 0 ? {
				anchorNode: t,
				anchorOffset: n,
				focusNode: r,
				focusOffset: i
			} : null;
		})(n, x, h, S, _);
	}
}
function yo(e, t) {
	for (let n of e.split(/(\r?\n|\t)/)) n === "\n" || n === "\r\n" ? t.linebreak() : n === "	" ? t.tab() : n !== "" && t.text(n);
}
function bo(e) {
	let t = [];
	return yo(e, {
		linebreak: () => t.push(Ss()),
		tab: () => t.push(ja()),
		text: (e) => t.push(Da(e))
	}), t;
}
function xo(e) {
	let t = [];
	for (let n of e) Cs(n) || (!B(n) && !V(n) || n.isInline() ? t.push(n) : B(n) && t.push(...xo(n.getChildren())));
	return t;
}
function So(e, t = !1) {
	let n = e;
	e.isCollapsed() || n.removeText();
	let r = F();
	P(r) && (n = r), P(n) || T(161);
	let i = n.anchor, a = i.getNode(), o = i.offset;
	for (; !q(a) && Pu(a) === null;) {
		let e = a;
		if ([a, o] = Co(a, o, t), e.is(a)) break;
	}
	return [a, o];
}
function Co(e, t, n = !1) {
	let r = e.getParent();
	if (!r) {
		let e = qs();
		return Mc().append(e), e.select(), [Mc(), 0];
	}
	if (N(e)) {
		let n = e.splitText(t);
		if (n.length === 0) return [r, e.getIndexWithinParent()];
		let i = t === 0 ? 0 : 1;
		return [r, n[0].getIndexWithinParent() + i];
	}
	if (!B(e) || t === 0) return [r, e.getIndexWithinParent()];
	let i = e.getChildAtIndex(t);
	if (i) {
		let r = new Va(Pa(e.__key, t, "element"), Pa(e.__key, t, "element"), 0, ""), a = e.insertNewAfter(r);
		if (a) a.append(i, ...i.getNextSiblings());
		else if (n) return [e, t];
	}
	return [r, e.getIndexWithinParent() + 1];
}
function wo(e) {
	return Cs(e) || ll(e) || N(e) || e.isParentRequired();
}
function To(e) {
	let t = qs(), n = null;
	for (let r = 0; r < e.length; r++) {
		let i = e[r];
		if (wo(i)) {
			if (n === null) {
				n = i.createParentElementNode(), t.append(n);
				let a = e[r + 1];
				if (Cs(i) && (a === void 0 || !wo(a))) continue;
			}
			n.append(i);
		} else t.append(i), n = null;
	}
	return t;
}
function Eo(e, t, n, r, i = "decorators-and-blocks") {
	if (t === "move" && r === "character" && !e.isCollapsed()) {
		let [t, r] = n === e.isBackward() ? [e.focus, e.anchor] : [e.anchor, e.focus];
		return r.set(t.key, t.offset, t.type), !0;
	}
	let a = Ds(e.focus, n ? "previous" : "next"), o = r === "lineboundary", s = t === "move", c = a, l = i === "decorators-and-blocks", u = !1;
	if (!Ls(c)) {
		for (let e of c) {
			l = !1;
			let { origin: t } = e;
			if (V(t)) {
				if (t.isIsolated()) {
					u = !0;
					break;
				}
				if (c = e, o && t.isInline()) continue;
			}
			break;
		}
		if (u) return !0;
		if (l) for (let e of Z(a).iterNodeCarets(t === "extend" ? "shadowRoot" : "root")) {
			if (sd(e)) e.origin.isInline() || (c = e);
			else {
				if (B(e.origin)) continue;
				V(e.origin) && !e.origin.isInline() && (c = e);
			}
			break;
		}
	}
	if (c === a) return !1;
	if (s && !o && V(c.origin) && c.origin.isKeyboardSelectable()) {
		let e = uo();
		return e.add(c.origin.getKey()), Pc(e), !0;
	}
	return c = Is(c), s && Os(e.anchor, c), Os(e.focus, c), l || !o;
}
var Do = null, Oo = null, ko = !1, Ao = !1, jo = !1, Mo = /* @__PURE__ */ new Set(), No = /* @__PURE__ */ new Set(), Po = 0, Fo = {
	characterData: !0,
	childList: !0,
	subtree: !0
};
function Io() {
	return ko || Do !== null && Do._readOnly;
}
function Lo() {
	ko && T(13);
}
function Ro() {
	Po > 99 && T(14);
}
function zo() {
	return Do === null && T(195, Ho()), Do;
}
function Bo(e) {
	zo() !== null && Oo === null && (Oo = e), Oo !== e && le(378);
}
function z() {
	return Oo === null && T(337, Ho()), Oo;
}
function Vo() {
	z()._dirtyType = 2;
}
function Ho() {
	let e = 0, t = /* @__PURE__ */ new Set(), n = nc.version;
	if (typeof window < "u") for (let r of wl(document)) {
		let i = mc(r);
		if (fc(i)) e++;
		else if (i) {
			let e = String(i.constructor.version || "<0.17.1");
			e === n && (e += " (separately built, likely a bundler configuration issue)"), t.add(e);
		}
	}
	let r = ` Detected on the page: ${e} compatible editor(s) with version ${n}`;
	return t.size && (r += ` and incompatible editors with versions ${Array.from(t).join(", ")}`), r;
}
function Uo() {
	return Oo;
}
function Wo(e, t, n) {
	let r = t.__type, i = sc(e, r), a = n.get(r);
	a === void 0 && (a = Array.from(i.transforms), n.set(r, a));
	let o = a.length;
	for (let e = 0; e < o && (a[e](t), t.isAttached()); e++);
}
function Go(e, t) {
	return e !== void 0 && e.__key !== t && e.isAttached();
}
function Ko(e, t) {
	if (!t) return;
	let n = e._updateTags, r = t;
	Array.isArray(t) || (r = [t]);
	for (let e of r) n.add(e);
}
function qo(e, t) {
	let n = e.type, r = t.get(n);
	r === void 0 && T(17, n);
	let i = r.klass;
	e.type !== i.getType() && T(18, i.name);
	let a = i.importJSON(e), o = e.children;
	if (B(a) && Array.isArray(o)) for (let e = 0; e < o.length; e++) {
		let n = qo(o[e], t);
		a.append(n);
	}
	let s = e.$slots;
	if (s) {
		Mu(a) || T(379, i.name);
		for (let e in s) Yu(a, e, qo(s[e], t));
	}
	return a;
}
function Jo(e, t, n) {
	let r = Do, i = ko, a = Oo;
	Do = t, ko = !0, Oo = e;
	try {
		return n();
	} finally {
		Do = r, ko = i, Oo = a;
	}
}
function Yo(e, t) {
	let n = jo;
	jo = !0;
	try {
		let n = function(e) {
			if (No.has(e)) return !1;
			No.add(e);
			try {
				for (let t = 0; e._pendingEditorState !== null; t++) {
					let n = e._pendingEditorState._selection, r = e._rootElement;
					if (!Zo(e, n)) return !1;
					let i = (n === null || P(n)) && (e._headless || r === null || !r.isConnected);
					if (i || t === 100) return e._lastNotifiedSelection = n === null ? null : n.clone(), !i;
					ts(e, () => e.dispatchCommand(rr), void 0, !0);
				}
				return !1;
			} finally {
				No.delete(e);
			}
		}(e);
		(function(e, t) {
			let n = e._pendingEditorState, r = e._rootElement, i = e._headless || r === null;
			if (n === null) return void (!e._updating && e._deferred.length > 0 && $o(e, e._deferred));
			let a = e._editorState, o = a._selection, s = n._selection, c = e._dirtyType !== 0, l = Do, u = ko, d = Oo, f = e._updating, p = e._observer, m = null;
			if (e._pendingEditorState = null, e._editorState = n, !i && c && p !== null) {
				Oo = e, Do = n, ko = !1, e._updating = !0;
				try {
					let t = e._dirtyType, r = e._dirtyElements, i = e._dirtyLeaves;
					p.disconnect(), m = er(a, n, e, t, r, i);
				} catch (t) {
					if (t instanceof Error && e._onError(t), Ao) throw t;
					Xs(e, null, r, n), pt(e), e._dirtyType = 2, Ao = !0, Yo(e, a), Ao = !1;
					return;
				} finally {
					p.observe(r, Fo), e._updating = f, Do = l, ko = u, Oo = d;
				}
			}
			n._readOnly ||= !0;
			let h = e._dirtyLeaves, g = e._dirtyElements, _ = e._normalizedNodes, v = e._updateTags;
			c && (e._dirtyType = 0, e._cloneNotNeeded.clear(), e._dirtyLeaves = /* @__PURE__ */ new Set(), e._dirtyElements = /* @__PURE__ */ new Map(), e._normalizedNodes = /* @__PURE__ */ new Set()), e._updateTags = /* @__PURE__ */ new Set();
			let y = e._deferred;
			f || (e._deferred = []), function(e, t) {
				let n = e._decorators, r = e._pendingDecorators || n, i = t._nodeMap, a;
				for (a in r) i.has(a) || (r === n && (r = Ac(e)), delete r[a]);
			}(e, n);
			let b = i ? null : yl(cl(e));
			if (e._editable && b !== null && (c || s === null || s.dirty || !s.is(o)) && r !== null && !v.has("skip-dom-selection")) {
				Oo = e, Do = n;
				try {
					if (p !== null && p.disconnect(), c || s === null || s.dirty) {
						let t = e._blockCursorElement;
						t !== null && vl(t, e, r), vo(o, s, e, b, v, r);
					}
					(function(e, t, n) {
						let r = e._blockCursorElement;
						if (P(n) && n.isCollapsed() && n.anchor.type === "element" && t.contains(Nl(t))) {
							let i = n.anchor, a = i.getNode(), o = i.offset, s = !1, c = null;
							if (o === a.getChildrenSize()) _l(a.getChildAtIndex(o - 1)) && (s = !0);
							else {
								let t = a.getChildAtIndex(o);
								t !== null && _l(t) && (s = !0, c = e.getElementByKey(t.__key));
							}
							if (s) {
								let n = Bl(a, e.getElementByKey(a.__key), e).element;
								r === null && (e._blockCursorElement = r = function(e) {
									let t = e.theme, n = El().createElement("div");
									n.contentEditable = "false", n.setAttribute("data-lexical-cursor", "true");
									let r = t.blockCursor;
									return r !== void 0 && (typeof r == "string" && (r = t.blockCursor = Md(r)), r !== void 0 && n.classList.add(...r)), n;
								}(e._config)), t.style.caretColor = "transparent", c === null ? n.appendChild(r) : n.insertBefore(r, c);
								return;
							}
						}
						r !== null && vl(r, e, t);
					})(e, r, s);
				} finally {
					p !== null && p.observe(r, Fo), Oo = d, Do = l;
				}
			}
			m !== null && function(e, t, n, r, i) {
				let a = Array.from(e._listeners.mutation), o = a.length;
				for (let e = 0; e < o; e++) {
					let [o, s] = a[e];
					for (let e of s) {
						let a = t.get(e);
						a !== void 0 && o(a, {
							dirtyLeaves: r,
							prevEditorState: i,
							updateTags: n
						});
					}
				}
			}(e, m, v, h, a);
			let x = e._pendingDecorators;
			x !== null && (e._decorators = x, e._pendingDecorators = null, Xo("decorator", e, !0, x)), function(e, t, n) {
				let r = jc(t), i = jc(n);
				r !== i && Xo("textcontent", e, !0, i);
			}(e, t || a, n), Xo("update", e, !0, {
				dirtyElements: g,
				dirtyLeaves: h,
				editorState: n,
				mutatedNodes: m,
				normalizedNodes: _,
				prevEditorState: t || a,
				tags: v
			}), f || $o(e, y), function(e) {
				let t = e._updates;
				if (t.length === 0) return void (e._cascadeCount = 0);
				if (function(e) {
					Mo.has(e) || (Mo.add(e), setTimeout(() => {
						Mo.delete(e), e._cascadeCount = 0;
					}, 0));
				}(e), e._cascadeCount++ > 99) return e._updates = [], e._cascadeCount = 0, void e._onWarn(ce(437, e._config.namespace));
				let n = t.shift();
				if (n) {
					let [t, r] = n;
					ts(e, t, r);
				}
			}(e);
		})(e, t), n && e._onWarn(ce(436));
	} finally {
		jo = n;
	}
}
function Xo(e, t, n, ...r) {
	let i = t._updating;
	t._updating = n;
	try {
		let n = t._listeners[e], i = Array.from(n);
		for (let [e, t] of i) {
			t && t();
			let i = e(...r), a = typeof i == "function" ? i : void 0;
			n.has(e) ? n.set(e, a) : a && a();
		}
	} finally {
		t._updating = i;
	}
}
function Zo(e, t) {
	let n = e._lastNotifiedSelection;
	return t === null ? n !== null : !t.is(n);
}
function Qo(e, t, n, r) {
	let i = Rc(e), a;
	if (!jo) for (let e = 0; e < i.length; e++) i[e]._updating || (i[e]._cascadeCount = 0);
	if (t === rr) {
		if (Oo !== e || ko) {
			let i = !1;
			return ns(e, () => {
				i = Qo(e, t, n, r);
			}), i;
		}
		let i = zo()._selection;
		e._lastNotifiedSelection = i === null ? null : i.clone();
	}
	for (let e = 4; e >= 0; e--) for (let o = 0; o < i.length; o++) {
		let s = i[o];
		if (o > 0 && s._updating) {
			a = s;
			break;
		}
		let c = s._commands.get(t);
		if (c !== void 0) {
			let t = c[e];
			if (t.size > 0) {
				let e = !1;
				if (ns(s, () => {
					for (let i of t) if (i(n, r)) return void (e = !0);
				}), e) return e;
			}
		}
	}
	return a && a.update(() => {
		Qo(a, t, n, r);
	}), !1;
}
function $o(e, t) {
	if (e._deferred === t && (e._deferred = []), t.length !== 0) {
		let n = e._updating;
		e._updating = !0;
		try {
			for (let e = 0; e < t.length; e++) t[e]();
		} finally {
			e._updating = n;
		}
	}
}
function es(e, t) {
	let n = e._updates, r = t || !1;
	for (; n.length !== 0;) {
		let t = n.shift();
		if (t) {
			let [n, i] = t, a = e._pendingEditorState, o;
			i !== void 0 && (o = i.onUpdate, i.skipTransforms && (r = !0), i.discrete && (a === null && T(191), a._flushSync = !0), o && e._deferred.push(o), Ko(e, i.tag)), a == null ? ts(e, n, i) : n();
		}
	}
	return r;
}
function ts(e, t, n, r = !1) {
	let i = e._updateTags, a, o = !1, s = !1;
	n !== void 0 && (a = n.onUpdate, Ko(e, n.tag), o = n.skipTransforms || !1, s = n.discrete || !1), a && e._deferred.push(a);
	let c = e._editorState, l = e._pendingEditorState, u = !1;
	(l === null || l._readOnly) && (l = e._pendingEditorState = ms(l || c), u = !0), l._flushSync = s;
	let d = Do, f = ko, p = Oo, m = e._updating;
	Do = l, ko = !1, e._updating = !0, Oo = e;
	let h = e._headless || e.getRootElement() === null;
	ic(null);
	try {
		u && (h ? c._selection !== null && (l._selection = c._selection.clone()) : l._selection = function(e, t) {
			let n = e.getEditorState()._selection, r = yl(cl(e));
			return P(n) || n == null ? fo(n, r, e, t) : n.clone();
		}(e, n && n.event || null));
		let r = e._compositionKey;
		t(), o = es(e, o), function(e, t) {
			let n = t.getEditorState()._selection, r = e._selection;
			if (P(r)) {
				let e = r.anchor, t = r.focus, i;
				if (e.type === "text" && (i = e.getNode(), i.selectionTransform(n, r)), t.type === "text") {
					let e = t.getNode();
					i !== e && e.selectionTransform(n, r);
				}
			}
		}(l, e), e._dirtyType !== 0 && (o ? function(e, t) {
			let n = t._dirtyLeaves, r = e._nodeMap;
			for (let e of n) {
				let t = r.get(e);
				N(t) && t.isAttached() && t.isSimpleText() && !t.isUnmergeable() && nn(t);
			}
		}(l, e) : function(e, t) {
			let n = t._dirtyLeaves, r = t._dirtyElements, i = e._nodeMap, a = Tc(), o = /* @__PURE__ */ new Map(), s = n, c = s.size, l = r, u = l.size;
			for (; c > 0 || u > 0;) {
				if (c > 0) {
					t._dirtyLeaves = /* @__PURE__ */ new Set();
					for (let e of s) {
						let r = i.get(e);
						N(r) && r.isAttached() && r.isSimpleText() && !r.isUnmergeable() && nn(r), r !== void 0 && Go(r, a) && Wo(t, r, o), n.add(e);
					}
					if (s = t._dirtyLeaves, c = s.size, c > 0) {
						Po++;
						continue;
					}
				}
				t._dirtyLeaves = /* @__PURE__ */ new Set(), t._dirtyElements = /* @__PURE__ */ new Map(), l.delete("root") && l.set("root", !0);
				for (let e of l) {
					let n = e[0], s = e[1];
					if (r.set(n, s), !s) continue;
					let c = i.get(n);
					c !== void 0 && Go(c, a) && Wo(t, c, o);
				}
				s = t._dirtyLeaves, c = s.size, l = t._dirtyElements, u = l.size, Po++;
			}
			t._dirtyLeaves = n, t._dirtyElements = r;
		}(l, e), es(e), function(e, t, n, r) {
			let i = e._nodeMap, a = t._nodeMap, o = [];
			for (let [e] of r) {
				let t = a.get(e);
				t !== void 0 && (t.isAttached() || (B(t) && rt(t, e, i, a, o, r), i.has(e) || r.delete(e), o.push(e)));
			}
			for (let e of n) {
				let t = a.get(e);
				t === void 0 || t.isAttached() || (Mu(t) && t.__slots !== null && rt(t, e, i, a, o, n), i.has(e) || n.delete(e), o.push(e));
			}
			let s = z(), c = s._cloneNotNeeded;
			for (let e of o) a.delete(e), c.delete(e);
			let l = s._compositionKey;
			l === null || a.has(l) || (s._compositionKey = null);
		}(c, l, e._dirtyLeaves, e._dirtyElements)), r !== e._compositionKey && (l._flushSync = !0);
		let i = l._selection;
		if (P(i)) {
			e._slotsUsed && ao(i);
			let t = l._nodeMap, n = i.anchor.key, r = i.focus.key;
			t.get(n) !== void 0 && t.get(r) !== void 0 || T(19);
		} else Ha(i) && i._nodes.size === 0 && (l._selection = null);
	} catch (t) {
		t instanceof Error && e._onError(t), e._pendingEditorState = c;
		let n = c._selection;
		e._lastNotifiedSelection = n === null ? null : n.clone(), e._dirtyType = 2, e._cloneNotNeeded.clear(), e._dirtyLeaves = /* @__PURE__ */ new Set(), e._dirtyElements.clear(), Yo(e);
		return;
	} finally {
		Do = d, ko = f, Oo = p, e._updating = m, Po = 0;
	}
	r || (e._dirtyType !== 0 || e._deferred.length > 0 || function(e, t) {
		let n = t.getEditorState()._selection, r = e._selection;
		if (r !== null) {
			if (r.dirty || !r.is(n)) return !0;
		} else if (n !== null) return !0;
		return !1;
	}(l, e) ? l._flushSync ? (l._flushSync = !1, Yo(e)) : u && lc(() => {
		Yo(e);
	}) : (l._flushSync = !1, u && (i.clear(), e._deferred = [], e._pendingEditorState = null)));
}
function ns(e, t, n) {
	Oo === e && n === void 0 ? Io() ? ts(e, t, n) : t() : ts(e, t, n);
}
function rs() {
	return {
		...Ne,
		0: ""
	};
}
function is() {
	return {
		...je,
		"": 0
	};
}
var as = /* @__PURE__ */ rs(), os = /* @__PURE__ */ is(), ss = /* @__PURE__ */ Pt()({
	direction: /* @__PURE__ */ It(/* @__PURE__ */ Nt([
		null,
		"ltr",
		"rtl"
	]), { field: "__dir" }),
	format: /* @__PURE__ */ It(/* @__PURE__ */ Nt([
		"",
		"left",
		"start",
		"center",
		"right",
		"end",
		"justify"
	]), {
		field: "__format",
		getter: "getFormatType",
		getterTable: as,
		setter: "setFormat",
		setterTable: os
	}),
	indent: /* @__PURE__ */ It(/* @__PURE__ */ Mt(0, {
		integer: !0,
		min: 0
	}), { field: "__indent" }),
	textFormat: /* @__PURE__ */ Lt(/* @__PURE__ */ Mt(), {
		getter: {
			field: "__textFormat",
			method: "getSerializedTextFormat",
			when: "shouldSerializeTextStyles"
		},
		setter: { field: "__textFormat" }
	}),
	textStyle: /* @__PURE__ */ Lt(/* @__PURE__ */ At(), {
		getter: {
			field: "__textStyle",
			method: "getSerializedTextStyle",
			when: "shouldSerializeTextStyles"
		},
		setter: { field: "__textStyle" }
	})
});
function cs(e) {
	if (fl(e)) {
		let t = null;
		for (let n of e.getChildren()) t = n.isInline() ? (t || n.replace(n.createParentElementNode())).append(n) : null;
	}
}
var ls = class extends Wi {
	__first;
	__last;
	__size;
	__format;
	__style;
	__indent;
	__dir;
	__textFormat;
	__textStyle;
	__slotHost;
	__slots;
	$config() {
		return this.config(Symbol.for("ElementNode"), {
			$transform: cs,
			extends: Wi,
			generated: ta,
			json: ss
		});
	}
	constructor(e) {
		super(e), this.__first = null, this.__last = null, this.__size = 0, this.__format = 0, this.__style = "", this.__indent = 0, this.__dir = null, this.__textFormat = 0, this.__textStyle = "", this.__slotHost = null, this.__slots = null;
	}
	afterCloneFrom(e) {
		super.afterCloneFrom(e), this.__key === e.__key && (this.__first = e.__first, this.__last = e.__last, this.__size = e.__size, this.__slotHost = e.__slotHost, this.__slotHost !== null && this.__parent !== null && T(384, this.__key, String(this.__slotHost), String(this.__parent)), this.__slots = e.__slots), this.__style = e.__style, function(e, t) {
			e.__dir = t.__dir, e.__format = t.__format, e.__indent = t.__indent, e.__textFormat = t.__textFormat, e.__textStyle = t.__textStyle;
		}(this, e);
	}
	getFormat() {
		return this.getLatest().__format;
	}
	getFormatType() {
		return Ne[this.getFormat()] || "";
	}
	getStyle() {
		return this.getLatest().__style;
	}
	getIndent() {
		return this.getLatest().__indent;
	}
	getChildren() {
		let e = [], t = this.getFirstChild();
		for (; t !== null;) e.push(t), t = t.getNextSibling();
		return e;
	}
	getChildrenKeys() {
		let e = [], t = this.getFirstChild();
		for (; t !== null;) e.push(t.__key), t = t.getNextSibling();
		return e;
	}
	getChildrenSize() {
		return this.getLatest().__size;
	}
	isEmpty() {
		return this.getChildrenSize() === 0 && Bu(this).length === 0;
	}
	isDirty() {
		let e = z()._dirtyElements;
		return e !== null && e.has(this.__key);
	}
	isLastChild() {
		let e = this.getLatest(), t = this.getParentOrThrow().getLastChild();
		return t !== null && t.is(e);
	}
	getAllTextNodes() {
		let e = [];
		for (let t of Bu(this)) {
			let n = Vu(this, t);
			if (B(n)) for (let t of n.getAllTextNodes()) e.push(t);
		}
		let t = this.getFirstChild();
		for (; t !== null;) {
			if (N(t) && e.push(t), B(t)) for (let n of t.getAllTextNodes()) e.push(n);
			t = t.getNextSibling();
		}
		return e;
	}
	getFirstDescendant() {
		let e = this.getFirstChild();
		for (; B(e);) {
			let t = e.getFirstChild();
			if (t === null) break;
			e = t;
		}
		return e;
	}
	getLastDescendant() {
		let e = this.getLastChild();
		for (; B(e);) {
			let t = e.getLastChild();
			if (t === null) break;
			e = t;
		}
		return e;
	}
	getDescendantByIndex(e) {
		let t = this.getChildren(), n = t.length;
		if (e >= n) {
			let e = t[n - 1];
			return B(e) && e.getLastDescendant() || e || null;
		}
		let r = t[e];
		return B(r) && r.getFirstDescendant() || r || null;
	}
	getFirstChild() {
		let e = this.getLatest().__first;
		return e === null ? null : H(e);
	}
	getFirstChildOrThrow() {
		let e = this.getFirstChild();
		return e === null && T(45, this.__key), e;
	}
	getLastChild() {
		let e = this.getLatest().__last;
		return e === null ? null : H(e);
	}
	getLastChildOrThrow() {
		let e = this.getLastChild();
		return e === null && T(96, this.__key), e;
	}
	getChildAtIndex(e) {
		let t = this.getChildrenSize(), n, r;
		if (e < t / 2) {
			for (n = this.getFirstChild(), r = 0; n !== null && r <= e;) {
				if (r === e) return n;
				n = n.getNextSibling(), r++;
			}
			return null;
		}
		for (n = this.getLastChild(), r = t - 1; n !== null && r >= e;) {
			if (r === e) return n;
			n = n.getPreviousSibling(), r--;
		}
		return null;
	}
	getTextContent() {
		let e = qu(this), t = this.getChildren(), n = t.length;
		for (let r = 0; r < n; r++) {
			let i = t[r];
			e += i.getTextContent(), B(i) && r !== n - 1 && !i.isInline() && (e += De);
		}
		return e;
	}
	getTextContentSize() {
		let e = function(e) {
			let t = 0;
			for (let n of Bu(e)) {
				let r = Vu(e, n);
				r !== null && (t += r.getTextContentSize());
			}
			return t;
		}(this), t = this.getChildren(), n = t.length;
		for (let r = 0; r < n; r++) {
			let i = t[r];
			e += i.getTextContentSize(), B(i) && r !== n - 1 && !i.isInline() && (e += 2);
		}
		return e;
	}
	getDirection() {
		return this.getLatest().__dir;
	}
	getTextFormat() {
		return this.getLatest().__textFormat;
	}
	hasFormat(e) {
		if (e !== "") {
			let t = je[e];
			return (this.getFormat() & t) !== 0;
		}
		return !1;
	}
	hasTextFormat(e) {
		let t = ke[e];
		return (this.getTextFormat() & t) !== 0;
	}
	getFormatFlags(e, t) {
		return bc(this.getLatest().__textFormat, e, t);
	}
	getTextStyle() {
		return this.getLatest().__textStyle;
	}
	select(e, t) {
		Lo();
		let n = F(), r = e, i = t, a = this.getChildrenSize();
		if (!this.canBeEmpty()) {
			if (e === 0 && t === 0) {
				let e = this.getFirstChild();
				if (N(e) || B(e)) return e.select(0, 0);
			} else if (!(e !== void 0 && e !== a || t !== void 0 && t !== a)) {
				let e = this.getLastChild();
				if (N(e) || B(e)) return e.select();
			}
		}
		r === void 0 && (r = a), i === void 0 && (i = a);
		let o = this.__key;
		return P(n) ? (n.anchor.set(o, r, "element"), n.focus.set(o, i, "element"), n.dirty = !0, n) : co(o, r, o, i, "element", "element");
	}
	selectStart() {
		let e = this.getFirstDescendant();
		return e ? e.selectStart() : this.select();
	}
	selectEnd() {
		let e = this.getLastDescendant();
		return e ? e.selectEnd() : this.select();
	}
	clear() {
		let e = this.getWritable();
		return this.getChildren().forEach((e) => e.remove()), e;
	}
	append(...e) {
		return this.splice(this.getChildrenSize(), 0, e);
	}
	setDirection(e) {
		let t = this.getWritable();
		return t.__dir = e, t;
	}
	setFormat(e) {
		let t = this.getWritable();
		return t.__format = e !== "" && je[e] || 0, t;
	}
	setStyle(e) {
		let t = this.getWritable();
		return t.__style = e || "", t;
	}
	setTextFormat(e) {
		let t = this.getWritable();
		return t.__textFormat = e, t;
	}
	setTextStyle(e) {
		let t = this.getWritable();
		return t.__textStyle = e, t;
	}
	setIndent(e) {
		let t = this.getWritable();
		return t.__indent = e, t;
	}
	splice(e, t, n) {
		Hi(this) && T(324, this.__key, this.__type);
		let r = this.getChildrenSize(), i = this.getWritable();
		e + t <= r || T(226, String(e), String(t), String(r));
		for (let e of n);
		let a = i.__key, o = [], s = [], c = this.getChildAtIndex(e + t), l = null, u = r - t + n.length;
		if (e !== 0) {
			if (e === r) l = this.getLastChild();
			else {
				let t = this.getChildAtIndex(e);
				t !== null && (l = t.getPreviousSibling());
			}
		}
		if (t > 0) {
			let e = l === null ? this.getFirstChild() : l.getNextSibling();
			for (let n = 0; n < t; n++) {
				e === null && T(100);
				let t = e.getNextSibling(), n = e.__key;
				Sc(e.getWritable()), s.push(n), e = t;
			}
		}
		let d = l;
		for (let e of n) {
			d !== null && e.is(d) && (l = d = d.getPreviousSibling()), c !== null && e.is(c) && (c = c.getNextSibling());
			let t = e.getWritable();
			t.__parent === a && u--, Sc(t);
			let n = e.__key;
			if (d === null) i.__first = n, t.__prev = null;
			else {
				let e = d.getWritable();
				e.__next = n, t.__prev = e.__key;
			}
			e.__key === a && T(76), t.__parent = a, o.push(n), d = e;
		}
		if (c === null) d !== null && (d.getWritable().__next = null, i.__last = d.__key);
		else {
			let e = c.getWritable();
			if (d !== null) {
				let t = d.getWritable();
				e.__prev = d.__key, t.__next = c.__key;
			} else e.__prev = null;
		}
		if (i.__size = u, s.length) {
			let e = F();
			if (P(e)) {
				let t = new Set(s), n = new Set(o), { anchor: r, focus: i } = e;
				us(r, t, n) && go(r, r.getNode(), this, l, c), us(i, t, n) && go(i, i.getNode(), this, l, c), u !== 0 || this.canBeEmpty() || fl(this) || this.remove();
			}
		}
		return i;
	}
	getDOMSlot(e) {
		return new Ge(e);
	}
	exportDOM(e) {
		let { element: t } = super.exportDOM(e);
		if (W(t)) {
			let e = this.getIndent();
			e > 0 && (t.style.paddingInlineStart = 40 * e + "px", t.setAttribute("data-lexical-indent", String(e)));
			let n = this.getDirection();
			n && (t.dir = n);
		}
		return { element: t };
	}
	shouldSerializeTextStyles() {
		if (fl(this)) return !1;
		for (let e = this.getFirstChild(); e !== null; e = e.getNextSibling()) if (N(e)) return !1;
		return !0;
	}
	getSerializedTextFormat() {
		let e = this.getTextFormat();
		return e !== 0 && this.shouldSerializeTextStyles() ? e : void 0;
	}
	getSerializedTextStyle() {
		let e = this.getTextStyle();
		return e !== "" && this.shouldSerializeTextStyles() ? e : void 0;
	}
	insertNewAfter(e, t) {
		return null;
	}
	canIndent() {
		return !0;
	}
	collapseAtStart(e) {
		return !1;
	}
	excludeFromCopy(e) {
		return !1;
	}
	canReplaceWith(e) {
		return !0;
	}
	canInsertAfter(e) {
		return !0;
	}
	canBeEmpty() {
		return !0;
	}
	canInsertTextBefore() {
		return !0;
	}
	canInsertTextAfter() {
		return !0;
	}
	isInline() {
		return !1;
	}
	isShadowRoot() {
		return !1;
	}
	canMergeWith(e) {
		return !1;
	}
	extractWithChild(e, t, n) {
		return !1;
	}
	canMergeWhenEmpty() {
		return !1;
	}
	reconcileObservedMutation(e, t) {
		let n = Bl(this, e, t), r = n.getFirstChild();
		for (let e = this.getFirstChild(); e; e = e.getNextSibling()) {
			let i = t.getElementByKey(e.getKey());
			i !== null && (r == null ? (n.insertChild(i), r = i) : r !== i && n.replaceChild(i, r), r = r.nextSibling);
		}
	}
};
function B(e) {
	return e instanceof ls;
}
function us(e, t, n) {
	let r = e.getNode();
	for (; r;) {
		let e = r.__key;
		if (t.has(e) && !n.has(e)) return !0;
		r = r.getParent();
	}
	return !1;
}
var ds = class extends Wi {
	__slotHost;
	__slots;
	constructor(e) {
		super(e), this.__slotHost = null, this.__slots = null;
	}
	afterCloneFrom(e) {
		super.afterCloneFrom(e), this.__key === e.__key && (this.__slotHost = e.__slotHost, this.__slotHost !== null && this.__parent !== null && T(383, this.__key, String(this.__slotHost), String(this.__parent)), this.__slots = e.__slots);
	}
	decorate(e, t) {
		return null;
	}
	isIsolated() {
		return !1;
	}
	isInline() {
		return !0;
	}
	isKeyboardSelectable() {
		return !0;
	}
};
function V(e) {
	return e instanceof ds;
}
var fs = class extends ls {
	__cachedText;
	$config() {
		return this.config("root", { extends: ls });
	}
	constructor() {
		super("root"), this.__cachedText = null;
	}
	getTopLevelElementOrThrow() {
		T(51);
	}
	getTextContent() {
		let e = this.__cachedText;
		return e === null || !Io() && z()._dirtyType !== 0 ? super.getTextContent() : e;
	}
	remove() {
		T(52);
	}
	replace(e) {
		T(53);
	}
	insertBefore(e) {
		T(54);
	}
	insertAfter(e) {
		T(55);
	}
	updateDOM(e, t) {
		return !1;
	}
	splice(e, t, n) {
		for (let e of n) B(e) || V(e) || T(282);
		return super.splice(e, t, n);
	}
	static importJSON(e) {
		return Mc().updateFromJSON(e);
	}
	collapseAtStart() {
		return !0;
	}
};
function ps(e) {
	return e instanceof fs;
}
function ms(e) {
	return new vs(Ze(e._nodeMap), null, e._slotsUsed);
}
function hs() {
	return new vs(/* @__PURE__ */ new Map([["root", new fs()]]), null, !1);
}
function gs(e) {
	let t = e.constructor, n = nt(e);
	if (B(e)) {
		let t = n.children, r = e.getChildren();
		for (let e = 0; e < r.length; e++) t.push(gs(r[e]));
	}
	let r = Bu(e);
	if (r.length > 0) {
		let i = {};
		for (let n of r) {
			let r = Vu(e, n);
			r === null && T(366, t.name, n), i[n] = gs(r);
		}
		n.$slots = i;
	}
	return n;
}
function _s(e) {
	return e instanceof vs;
}
var vs = class e {
	_nodeMap;
	_selection;
	_flushSync;
	_readOnly;
	_parsed;
	_slotsUsed;
	constructor(e, t = null, n = !1) {
		this._nodeMap = e, this._selection = t || null, this._flushSync = !1, this._readOnly = !1, this._parsed = !1, this._slotsUsed = n;
	}
	isEmpty() {
		return this._nodeMap.size <= 1 && this._selection === null;
	}
	read(e, t) {
		return Jo(t && t.editor || null, this, e);
	}
	clone(t) {
		let n = new e(this._nodeMap, t === void 0 ? this._selection : t, this._slotsUsed);
		return n._readOnly = !0, n._parsed = this._parsed, n;
	}
	toJSON(e) {
		return et(typeof e == "boolean" && e, () => Jo(null, this, () => ({ root: gs(Mc()) })));
	}
}, ys = class extends ls {
	$config() {
		return this.config("artificial", { extends: ls });
	}
	createDOM(e) {
		return El().createElement("div");
	}
}, bs = class extends Wi {
	$config() {
		return this.config("linebreak", {
			extends: Wi,
			generated: aa,
			importDOM: { br: (e) => ws(e) || Ts(e) ? null : {
				conversion: xs,
				priority: 0
			} }
		});
	}
	getTextContent() {
		return "\n";
	}
	createDOM() {
		return El().createElement("br");
	}
	updateDOM() {
		return !1;
	}
	isInline() {
		return !0;
	}
};
function xs(e) {
	return { node: Ss() };
}
function Ss() {
	return ml(new bs());
}
function Cs(e) {
	return e instanceof bs;
}
function ws(e) {
	let t = e.parentElement;
	if (t !== null && K(t)) {
		let n = t.firstChild;
		if (n === e || n.nextSibling === e && Es(n)) {
			let n = t.lastChild;
			if (n === e || n.previousSibling === e && Es(n)) return !0;
		}
	}
	return !1;
}
function Ts(e) {
	let t = e.parentElement;
	if (t !== null && K(t)) {
		let n = t.firstChild;
		if (n === e || n.nextSibling === e && Es(n)) return !1;
		let r = t.lastChild;
		if (r === e || r.previousSibling === e && Es(r)) return !0;
	}
	return !1;
}
function Es(e) {
	return _c(e) && /^( |\t|\r?\n)+$/.test(e.textContent || "");
}
function Ds(e, t) {
	let { type: n, key: r, offset: i } = e, a = gl(e.key);
	return n === "text" ? (N(a) || T(266, a.getType(), r), fd(a, t, i)) : (B(a) || T(267, a.getType(), r), zs(a, e.offset, t));
}
function Os(e, t) {
	let { origin: n, direction: r } = t, i = r === "next";
	ad(t) ? e.set(n.getKey(), t.offset, "text") : od(t) ? N(n) ? e.set(n.getKey(), pd(n, r), "text") : e.set(n.getParentOrThrow().getKey(), n.getIndexWithinParent() + +!!i, "element") : (sd(t) && B(n) || T(268), e.set(n.getKey(), i ? 0 : n.getChildrenSize(), "element"));
}
function ks(e) {
	let t = F(), n = P(t) ? t : lo();
	return As(n, e), Pc(n), n;
}
function As(e, t) {
	Os(e.anchor, t.anchor), Os(e.focus, t.focus);
}
function js(e) {
	let { anchor: t, focus: n } = e, r = Ds(t, "next"), i = Ds(n, "next"), a = wd(r, i) <= 0 ? "next" : "previous";
	return Sd(bd(r, a), bd(i, a));
}
function Ms(e) {
	let { direction: t, origin: n } = e, r = dd(n, td(t)).getNodeAtCaret();
	return r ? dd(r, t) : hd(n.getParentOrThrow(), t);
}
function Ns(e, t = "root") {
	let n = [e];
	for (let r = sd(e) ? e.getParentCaret(t) : e.getSiblingCaret(); r !== null; r = r.getParentCaret(t)) n.push(Ms(r));
	return n;
}
function Ps(e) {
	return !!e && e.origin.isAttached();
}
function Fs(e, t = "removeEmptySlices") {
	if (e.isCollapsed()) return e;
	let n = "root", r = "next", i = t, a = Rs(e, r), o = a.anchor.origin;
	for (; o !== null && !fl(o);) o = o.getParent();
	let s = B(o) ? o.getFirstChild() : null, c = Ns(a.anchor, n), l = Ns(a.focus.getFlipped(), n), u = /* @__PURE__ */ new Set(), d = [];
	for (let e of a.iterNodeCarets(n)) if (sd(e)) u.add(e.origin.getKey());
	else if (od(e)) {
		let { origin: t } = e;
		B(t) && !u.has(t.getKey()) || d.push(t);
	}
	let f = /* @__PURE__ */ new Set();
	for (let e of d) {
		let t = e.getParent();
		t === null || u.has(t.getKey()) || f.add(t), Sc(e);
	}
	for (let e of f) !e.canBeEmpty() && !fl(e) && e.isEmpty() && e.isAttached() && e.remove();
	for (let e of a.getTextSlices()) {
		if (!e) continue;
		let { origin: t } = e.caret, n = t.getTextContentSize(), a = Ms(dd(t, r)), o = t.getMode();
		if (Math.abs(e.distance) === n && i === "removeEmptySlices" || o === "token" && e.distance !== 0) a.remove();
		else if (e.distance !== 0) {
			i = "removeEmptySlices";
			let t = e.removeTextSlice(), n = e.caret.origin;
			if (o === "segmented") {
				let e = t.origin, n = Da(e.getTextContent()).setStyle(e.getStyle()).setFormat(e.getFormat());
				a.replaceOrInsert(n), t = fd(n, r, t.offset);
			}
			n.is(c[0].origin) && (c[0] = t), n.is(l[0].origin) && (l[0] = t.getFlipped());
		}
	}
	let p, m;
	for (let e of c) if (Ps(e)) {
		p = Is(e);
		break;
	}
	for (let e of l) if (Ps(e)) {
		m = Is(e);
		break;
	}
	let h = function(e, t, n) {
		if (!e || !t) return null;
		let r = e.getParentAtCaret(), i = t.getParentAtCaret();
		if (!r || !i) return null;
		let a = r.getParents().reverse();
		a.push(r);
		let o = i.getParents().reverse();
		o.push(i);
		let s = Math.min(a.length, o.length), c = 0;
		for (; c < s && a[c] === o[c]; c++);
		let l = (e, t) => {
			let n;
			for (let r = c; r < e.length; r++) {
				let i = e[r];
				if (fl(i)) return;
				!n && t(i) && (n = i);
			}
			return n;
		}, u = l(a, q), d = u && l(o, (e) => n.has(e.getKey()) && q(e));
		return d && Bu(d).length > 0 ? null : u && d ? [u, d] : null;
	}(p, m, u);
	if (h) {
		let [e, t] = h;
		hd(e, "previous").splice(0, t.getChildren());
		let n = t.getParent();
		for (t.remove(!0); n && n.isEmpty();) {
			let e = n;
			n = n.getParent(), e.remove(!0);
		}
	} else if (m) {
		let e = function(e) {
			if (sd(e)) {
				let t = e.origin;
				if (q(t)) return t;
			} else {
				let t = e.getParentAtCaret();
				if (t && q(t)) return t;
			}
			return null;
		}(m), t = e && e.getParent(), n = e && e.getParents().findLast(dl);
		if (e && t && !ps(t) && e.isEmpty() && u.has(e.getKey()) && Bu(e).length === 0 && (!n || u.has(n.getKey()))) {
			e.remove(!0);
			let n = t;
			for (; n && !ps(n) && n.isEmpty();) {
				let e = n.getParent();
				if (e && ps(e) && e.getChildrenSize() <= 1 && n.canBeEmpty()) break;
				let t = n;
				n = e, t.remove(!0);
			}
		}
	}
	Nc(o, s) !== null || o === null || o.isAttached() || Nc(Mc(), null);
	let g = [
		p,
		m,
		...c,
		...l
	].find(Ps);
	if (g) return xd(bd(Is(g), e.direction));
	T(269, JSON.stringify(c.map((e) => e.origin.__key)));
}
function Is(e) {
	let t = function(e) {
		let t = e;
		for (; sd(t);) {
			let e = _d(t);
			if (!sd(e)) break;
			t = e;
		}
		return t;
	}(e.getLatest()), { direction: n } = t;
	if (N(t.origin)) return ad(t) ? t : fd(t.origin, n, n);
	let r = t.getAdjacentCaret();
	return od(r) && N(r.origin) ? fd(r.origin, n, td(n)) : t;
}
function Ls(e) {
	return ad(e) && e.offset !== pd(e.origin, e.direction);
}
function Rs(e, t) {
	return e.direction === t ? e : Sd(bd(e.focus, t), bd(e.anchor, t));
}
function zs(e, t, n) {
	let r = hd(e, "next");
	for (let e = 0; e < t; e++) {
		let e = r.getAdjacentCaret();
		if (e === null) break;
		r = e;
	}
	return bd(r, n);
}
function Bs(e) {
	let { origin: t, offset: n, direction: r } = e;
	if (n === pd(t, r)) return e.getSiblingCaret();
	if (n === pd(t, td(r))) return Ms(e.getSiblingCaret());
	let [i] = t.splitText(n);
	return N(i) || T(281), bd(dd(i, "next"), r);
}
function Vs(e, t) {
	return !0;
}
function Hs(e, { $copyElementNode: t = pl, $splitTextPointCaretNext: n = Bs, rootMode: r = "shadowRoot", $shouldSplit: i = Vs, removeEmptyDestination: a = !1 } = {}) {
	if (ad(e)) return n(e);
	let o = e.getParentCaret(r);
	if (o) {
		let { origin: n } = o;
		if (sd(e)) {
			let e = Ms(o);
			if (a && n.isEmpty()) return n.remove(), e;
			if (!n.canBeEmpty() || !i(n, "first")) return e;
		}
		let r = function(e) {
			let t = [];
			for (let n = e.getAdjacentCaret(); n; n = n.getAdjacentCaret()) t.push(n.origin);
			return t;
		}(e);
		(r.length > 0 || !a && n.canBeEmpty() && i(n, "last")) && o.insert(t(n).splice(0, 0, r));
	}
	return o;
}
function Us(e, t, n) {
	let r = bd(t, "next");
	ad(r) && (r.offset === 0 ? r = dd(r.origin, "previous").getFlipped() : r.offset === r.origin.getTextContentSize() && (r = dd(r.origin, "next"))), r.origin.is(e) && (od(r) || T(342, e.getKey(), e.getType()), r = Ms(r)), (e.is(r.getNodeAtCaret()) || e.is(r.getFlipped().getNodeAtCaret())) && e.remove(!0);
	for (let e = r; e; e = Hs(e, n)) r = e;
	return ad(r) && T(283), r.insert(e.isInline() ? qs().append(e) : e), bd(dd(e.getLatest(), "next"), t.direction);
}
function Ws(e, t) {
	let n = Rs(P(t) ? js(t) : t, "next"), r = Lu(n.anchor.origin), i = Lu(e.getLatest());
	if (r === null ? i !== null : !r.is(i)) return !1;
	let a = Is(hd(e, "next")), o = bd(Is(hd(e, "previous")), "next");
	return wd(n.anchor, a) <= 0 && wd(n.focus, o) >= 0;
}
var Gs = class extends ls {
	$config() {
		return this.config("paragraph", {
			extends: ls,
			generated: ia,
			importDOM: { p: () => ({
				conversion: Ks,
				priority: 0
			}) }
		});
	}
	createDOM(e) {
		let t = El().createElement("p"), n = Jc(e.theme, "paragraph");
		return n !== void 0 && t.classList.add(...n), t;
	}
	updateDOM(e, t, n) {
		return !1;
	}
	exportDOM(e) {
		let { element: t } = super.exportDOM(e);
		if (W(t)) {
			this.isEmpty() && t.append(El().createElement("br"));
			let e = this.getFormatType();
			e && (t.style.textAlign = e);
		}
		return { element: t };
	}
	exportJSON(e = !1) {
		let t = super.exportJSON(e);
		if (t.textFormat === void 0 || t.textStyle === void 0) {
			let n = this.getChildren().find(N), r = n ? n.getFormat() : this.getTextFormat(), i = n ? n.getStyle() : this.getTextStyle();
			e && r === 0 || (t.textFormat = r), e && i === "" || (t.textStyle = i);
		}
		return t;
	}
	extractWithChild(e, t, n) {
		if (!P(t) || this.getFormatType() === "" && this.getIndent() === 0 && this.getStyle() === "") return !1;
		if (Ws(this, t)) {
			let e = this.getTextContent();
			return e !== "" && t.getTextContent() === e;
		}
		return !1;
	}
	insertNewAfter(e, t) {
		let n = qs();
		n.setTextFormat(e.format), n.setTextStyle(e.style);
		let r = this.getDirection();
		return n.setDirection(r), n.setFormat(this.getFormatType()), n.setStyle(this.getStyle()), this.insertAfter(n, t), n;
	}
	collapseAtStart() {
		if (this.getChildren().every((e) => N(e) && !/\S/.test(e.getTextContent()))) {
			if (this.getNextSibling() !== null) return this.selectNext(), this.remove(), !0;
			if (this.getPreviousSibling() !== null) return this.selectPrevious(), this.remove(), !0;
		}
		return !1;
	}
};
function Ks(e) {
	let t = qs();
	if (Xl(t, e), Jl(e, t), t.getFormatType() === "") {
		let n = e.getAttribute("align");
		n && n && n in je && t.setFormat(n);
	}
	return Yl(t, e), { node: t };
}
function qs() {
	return ml(new Gs());
}
function Js(e) {
	return e instanceof Gs;
}
function Ys(e) {
	console.warn(e);
}
function Xs(e, t, n, r, i) {
	let a = e._keyToDOMMap;
	a.clear(), e._editorState = hs(), e._pendingEditorState = r, e._compositionKey = null, e._dirtyType = 0, e._cloneNotNeeded.clear(), e._dirtyLeaves = /* @__PURE__ */ new Set(), e._dirtyElements.clear(), e._normalizedNodes = /* @__PURE__ */ new Set(), i && i.preserveUpdateQueue || (e._updateTags = /* @__PURE__ */ new Set(), e._updates = [], e._cascadeCount = 0), e._blockCursorElement = null, e._inputState.handledSelectionCommandTimeoutId !== null && clearTimeout(e._inputState.handledSelectionCommandTimeoutId), e._inputState = {
		collapsedSelectionFormat: {
			format: 0,
			key: "root",
			offset: 0,
			style: "",
			timeStamp: 0
		},
		compositionEndData: "",
		compositionPhase: "idle",
		hadOrphanedCompositionEvents: !1,
		handledSelectionCommandTimeoutId: null,
		isInsertLineBreak: !1,
		isInsertTextAfterHandledSelectionCommand: !1,
		isSelectionChangeFromDOMUpdate: !1,
		isSelectionChangeFromMouseDown: !1,
		isShiftKeyDown: !1,
		lastBeforeInputInsertTextTimeStamp: 0,
		lastKeyCode: null,
		lastKeyDownTimeStamp: 0,
		postDeleteSelectionToRestore: null,
		selectionChangeFromDOMUpdatePoints: null,
		unprocessedBeforeInputData: null
	};
	let o = e._observer;
	o !== null && (o.disconnect(), e._observer = null), t !== null && (t.textContent = "", function(e, t) {
		delete e[`__lexicalKey_${t._key}`];
	}(t, e)), n !== null && (n.textContent = "", a.set("root", n), Dc(n, e, "root"));
}
function Zs(e) {
	let t = /* @__PURE__ */ new Set(), n = /* @__PURE__ */ new Set();
	for (let { klass: r, ownNodeConfig: i } of Eu(e)) {
		let e = r.transform;
		if (!n.has(e)) {
			n.add(e);
			let i = r.transform();
			i && t.add(i);
		}
		if (i) {
			let e = i.$transform;
			e && t.add(e);
		}
	}
	return t;
}
var Qs = {
	$createDOM: (e, t) => e.createDOM(t._config, t),
	$decorateDOM: (e, t, n, r) => {},
	$exportDOM: (e, t) => {
		let n = cc(t, e.getType());
		return n && n.exportDOM !== void 0 ? n.exportDOM(t, e) : e.exportDOM(t);
	},
	$extractWithChild: (e, t, n, r, i) => B(e) && e.extractWithChild(t, n, r),
	$getDOMSlot: (e, t, n) => e.getDOMSlot(t),
	$getSlotTargetElement: (e, t, n, r) => null,
	$shouldExclude: (e, t, n) => B(e) && e.excludeFromCopy("html"),
	$shouldInclude: (e, t, n) => !t || e.isSelected(t),
	$updateDOM: (e, t, n, r) => e.updateDOM(t, n, r._config)
};
function $s(e) {
	let t = e || {}, n = Uo(), r = t.theme || {}, i = e === void 0 ? n : t.parentEditor || null, a = t.disableEvents || !1, o = hs(), s = t.namespace || (i === null ? zc() : i._config.namespace), c = t.editorState, l = [
		fs,
		va,
		bs,
		Aa,
		Gs,
		ys,
		...t.nodes || []
	], { onError: u, onWarn: d, html: f } = t, p = t.editable === void 0 || t.editable, m;
	if (e === void 0 && n !== null) m = n._nodes;
	else {
		m = /* @__PURE__ */ new Map();
		for (let e = 0; e < l.length; e++) {
			let n = l[e], r = null, i = null;
			if (n && typeof n == "object") {
				let e = n;
				n = e.replace, r = e.with, i = e.withKlass || null;
			}
			if (typeof n != "function" || !n.prototype || !(n === Wi || n.prototype instanceof Wi)) {
				let r = "<unknown>";
				try {
					r = JSON.parse(Je);
				} catch {}
				T(365, String(e - l.length + (t.nodes ? t.nodes.length : 0)), typeof n == "function" ? `${n.name}${typeof n.getType == "function" ? ` (type ${String(n.getType())})` : ""}` : String(n), String(r));
			}
			xu(n);
			let a = n.getType(), o = Zs(n);
			m.set(a, {
				exportDOM: f && f.export ? f.export.get(n) : void 0,
				klass: n,
				replace: r,
				replaceWithKlass: i,
				sharedNodeState: Wt(l[e]),
				transforms: o
			});
		}
	}
	let h = new nc(o, i, m, {
		disableEvents: a,
		dom: {
			...Qs,
			...e && e.dom
		},
		namespace: s,
		theme: r
	}, u || console.error, d || Ys, function(e, t) {
		let n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Set(), i = (e) => {
			Object.keys(e).forEach((t) => {
				let r = n.get(t);
				r === void 0 && (r = [], n.set(t, r)), r.push(e[t]);
			});
		};
		return e.forEach((e) => {
			let t = e.klass.importDOM;
			if (t == null || r.has(t)) return;
			r.add(t);
			let n = t.call(e.klass);
			n !== null && i(n);
		}), t && i(t), n;
	}(m, f ? f.import : void 0), p, e);
	return c !== void 0 && (h._pendingEditorState = c, h._dirtyType = 2), function(e) {
		e.registerCommand(ar, yi, 0), e.registerCommand(or, xi, 0), e.registerCommand(sr, Ci, 0), e.registerCommand(cr, wi, 0), e.registerCommand(br, Pi, 0);
	}(h), h;
}
function ec(e, t) {
	let n = e.get(t);
	e.delete(t), n && n();
}
function tc(e, t, n) {
	return e.set(t, n), ec.bind(null, e, t);
}
var nc = class {
	static version = Je;
	_headless;
	_parentEditor;
	_rootElement;
	_editorState;
	_pendingEditorState;
	_compositionKey;
	_deferred;
	_keyToDOMMap;
	_updates;
	_updating;
	_cascadeCount;
	_listeners;
	_commands;
	_nodes;
	_decorators;
	_pendingDecorators;
	_config;
	_dirtyType;
	_cloneNotNeeded;
	_dirtyLeaves;
	_dirtyElements;
	_normalizedNodes;
	_updateTags;
	_observer;
	_key;
	_onError;
	_onWarn;
	_htmlConversions;
	_window;
	_editable;
	_blockCursorElement;
	_slotsUsed;
	_keyDownShortcuts;
	_inputState;
	_lastNotifiedSelection;
	_createEditorArgs;
	constructor(e, t, n, r, i, a, o, s, c) {
		this._createEditorArgs = c, this._parentEditor = t, this._rootElement = null, this._editorState = e, this._pendingEditorState = null, this._compositionKey = null, this._deferred = [], this._keyToDOMMap = new Qe(), this._updates = [], this._updating = !1, this._cascadeCount = 0, this._listeners = {
			decorator: /* @__PURE__ */ new Map(),
			editable: /* @__PURE__ */ new Map(),
			mutation: /* @__PURE__ */ new Map(),
			root: /* @__PURE__ */ new Map(),
			textcontent: /* @__PURE__ */ new Map(),
			update: /* @__PURE__ */ new Map()
		}, this._commands = /* @__PURE__ */ new Map(), this._config = r, this._nodes = n, this._decorators = {}, this._pendingDecorators = null, this._dirtyType = 0, this._cloneNotNeeded = /* @__PURE__ */ new Map(), this._dirtyLeaves = /* @__PURE__ */ new Set(), this._dirtyElements = /* @__PURE__ */ new Map(), this._normalizedNodes = /* @__PURE__ */ new Set(), this._updateTags = /* @__PURE__ */ new Set(), this._observer = null, this._key = zc(), this._onError = i, this._onWarn = a, this._htmlConversions = o, this._editable = s, this._headless = t !== null && t._headless, this._window = null, this._blockCursorElement = null, this._slotsUsed = !1, this._keyDownShortcuts = null, this._inputState = {
			collapsedSelectionFormat: {
				format: 0,
				key: "root",
				offset: 0,
				style: "",
				timeStamp: 0
			},
			compositionEndData: "",
			compositionPhase: "idle",
			hadOrphanedCompositionEvents: !1,
			handledSelectionCommandTimeoutId: null,
			isInsertLineBreak: !1,
			isInsertTextAfterHandledSelectionCommand: !1,
			isSelectionChangeFromDOMUpdate: !1,
			isSelectionChangeFromMouseDown: !1,
			isShiftKeyDown: !1,
			lastBeforeInputInsertTextTimeStamp: 0,
			lastKeyCode: null,
			lastKeyDownTimeStamp: 0,
			postDeleteSelectionToRestore: null,
			selectionChangeFromDOMUpdatePoints: null,
			unprocessedBeforeInputData: null
		}, this._lastNotifiedSelection = null;
	}
	isComposing() {
		return this._compositionKey != null;
	}
	registerUpdateListener(e) {
		return tc(this._listeners.update, e);
	}
	registerEditableListener(e) {
		return tc(this._listeners.editable, e);
	}
	registerDecoratorListener(e) {
		return tc(this._listeners.decorator, e);
	}
	registerTextContentListener(e) {
		return tc(this._listeners.textcontent, e);
	}
	registerRootListener(e) {
		let t = this._listeners.root;
		return Nd(tc(t, e, e(this._rootElement, null) || void 0), () => function(e, t, n) {
			let r = e.get(t);
			r && r(), e.set(t, t(...n) || void 0);
		}(t, e, [null, this._rootElement]));
	}
	registerCommand(e, t, n) {
		n === void 0 && T(35);
		let r = this._commands;
		r.has(e) || r.set(e, [
			new Ye(),
			new Ye(),
			new Ye(),
			new Ye(),
			new Ye()
		]);
		let i = r.get(e);
		i === void 0 && T(36, String(e));
		let a = function(e) {
			return 7 & e;
		}(n), o = i[a];
		return a === n ? o.addBack(t) : o.addFront(t), () => {
			o.delete(t), i.every((e) => e.size === 0) && r.delete(e);
		};
	}
	registerMutationListener(e, t, n) {
		let r = this.resolveRegisteredNodeAfterReplacements(this.getRegisteredNode(e)).klass, i = this._listeners.mutation, a = i.get(t);
		a === void 0 && (a = /* @__PURE__ */ new Set(), i.set(t, a)), a.add(r);
		let o = n && n.skipInitialization;
		return o !== void 0 && o || this.initializeMutationListener(t, r), () => {
			a.delete(r), a.size === 0 && i.delete(t);
		};
	}
	getRegisteredNode(e) {
		let t = this._nodes.get(e.getType());
		return t === void 0 && T(37, e.name), t;
	}
	resolveRegisteredNodeAfterReplacements(e) {
		for (; e.replaceWithKlass;) e = this.getRegisteredNode(e.replaceWithKlass);
		return e;
	}
	initializeMutationListener(e, t) {
		let n = this._editorState, r = Gl(n).get(t.getType());
		if (!r) return;
		let i = /* @__PURE__ */ new Map();
		for (let e of r.keys()) i.set(e, "created");
		i.size > 0 && e(i, {
			dirtyLeaves: /* @__PURE__ */ new Set(),
			prevEditorState: n,
			updateTags: /* @__PURE__ */ new Set(["registerMutationListener"])
		});
	}
	registerNodeTransformToKlass(e, t) {
		let n = this.getRegisteredNode(e);
		return n.transforms.add(t), n;
	}
	registerNodeTransform(e, t) {
		let n = this.registerNodeTransformToKlass(e, t), r = [n], i = n.replaceWithKlass;
		if (i != null) {
			let e = this.registerNodeTransformToKlass(i, t);
			r.push(e);
		}
		return function(e, t) {
			let n = Gl(e.getEditorState()), r = [];
			for (let e of t) {
				let t = n.get(e);
				t && r.push(t);
			}
			r.length !== 0 && e.update(() => {
				for (let e of r) for (let t of e.keys()) {
					let e = H(t);
					e && e.markDirty();
				}
			}, e._pendingEditorState === null ? { tag: "history-merge" } : void 0);
		}(this, r.map((e) => e.klass.getType())), () => {
			r.forEach((e) => e.transforms.delete(t));
		};
	}
	hasNode(e) {
		return this._nodes.has(e.getType());
	}
	hasNodes(e) {
		return e.every(this.hasNode.bind(this));
	}
	dispatchCommand(e, ...t) {
		return U(this, e, ...t);
	}
	getDecorators() {
		return this._decorators;
	}
	getRootElement() {
		return this._rootElement;
	}
	getKey() {
		return this._key;
	}
	setRootElement(e) {
		let t = this._rootElement;
		if (e !== t) {
			let n = Jc(this._config.theme, "root"), r = this._pendingEditorState || this._editorState;
			if (this._rootElement = e, Xs(this, t, e, r, { preserveUpdateQueue: !0 }), t !== null && (this._config.disableEvents || function(e) {
				let t = ii.get(e);
				if (t === void 0) return void Bi();
				let n = ai.get(t);
				if (n === void 0) return void Bi();
				ii.delete(e);
				let r = mc(e);
				fc(r) ? (function(e) {
					if (e._parentEditor !== null) {
						let t = Rc(e), n = t[t.length - 1]._key;
						Ii.get(n) === e && Ii.delete(n);
					} else Ii.delete(e._key);
				}(r), n.editors.delete(r), n.hasShadowEditor = void 0, e.__lexicalEditor = null) : r && T(198);
				let i = Fi(e);
				for (let e = 0; e < i.length; e++) i[e]();
				e.__lexicalEventHandles = [];
			}(t), n != null && t.classList.remove(...n)), e !== null) {
				let t = sl(e), r = e.style;
				r.userSelect = "text", r.whiteSpace = "pre-wrap", r.wordBreak = "break-word", e.setAttribute("data-lexical-editor", "true"), this._window = t, this._dirtyType = 2, pt(this), this._updateTags.add(qi), Yo(this), this._config.disableEvents || function(e, t) {
					let n = e.ownerDocument;
					ii.set(e, n);
					let r = ai.get(n);
					r === void 0 && (r = {
						editors: /* @__PURE__ */ new Set(),
						hasShadowEditor: void 0
					}, ai.set(n, r)), r.editors.add(t), r.hasShadowEditor = void 0, e.__lexicalEditor = t;
					let i = Fi(e);
					i.push(oi.register(n));
					let a = function() {
						if (ri !== void 0) return ri;
						let e = [
							["keydown", Oi],
							["pointerdown", pi],
							["compositionstart", Si],
							["compositionend", Di],
							["input", bi],
							["click", fi],
							["cut", ni],
							["copy", ni],
							["dragstart", ni],
							["dragover", ni],
							["dragend", ni],
							["paste", ni],
							["focus", ni],
							["blur", ni],
							["drop", ni]
						];
						return ge && e.push(["beforeinput", (e, t) => function(e, t) {
							let n = e.inputType;
							n === "deleteCompositionText" || O && Qc(t) || n !== "insertCompositionText" && ns(t, () => {
								vi(e, t) || U(t, ar, e);
							}, { event: e });
						}(e, t)]), ve && e.push(["keyup", (e, t) => function(e, t) {
							e.shiftKey && e.key !== "CapsLock" || (t._inputState.isShiftKeyDown = !1);
						}(e, t)]), ri = e, e;
					}();
					for (let n = 0; n < a.length; n++) {
						let [r, o] = a[n], s = typeof o == "function" ? (e) => {
							zi(e) || (Ri(e), (t.isEditable() || r === "click") && o(e, t));
						} : (e) => {
							if (zi(e)) return;
							Ri(e);
							let n = t.isEditable();
							switch (r) {
								case "cut": return n && U(t, Rr, e);
								case "copy": return U(t, Lr, e);
								case "paste": return n && U(t, pr, e);
								case "dragstart": return n && U(t, Pr, e);
								case "dragover": return n && U(t, Fr, e);
								case "dragend": return n && U(t, Ir, e);
								case "focus": return n && U(t, Wr, e);
								case "blur": return t._inputState.isShiftKeyDown = !1, t._inputState.isInsertLineBreak = !1, n && U(t, Gr, e);
								case "drop": return n && U(t, Nr, e);
							}
						};
						i.push(ti(e, r, s));
					}
				}(e, this), n != null && e.classList.add(...n);
			} else this._window = null, this._updateTags.add(qi), Yo(this);
			Xo("root", this, !1, e, t);
		}
	}
	getElementByKey(e) {
		return this._keyToDOMMap.get(e) || null;
	}
	getEditorState() {
		return this._editorState;
	}
	setEditorState(e, t) {
		let n = e.isEmpty(), r = e;
		r._readOnly && (r = ms(e), r._selection = e._selection ? e._selection.clone() : null), ft(this);
		let i = this._pendingEditorState, a = t === void 0 ? null : t.tag;
		i === null || i.isEmpty() || (a != null && this._updateTags.add(a), Yo(this)), this._pendingEditorState = r, this._dirtyType = 2, this._dirtyElements.set("root", !1), this._compositionKey = null, this._slotsUsed = this._slotsUsed || e._slotsUsed, ns(this, () => {
			if (a && this._updateTags.add(a), n && (le(38), Mc().append(qs())), e._parsed) for (let [e, t] of r._nodeMap.entries()) B(t) ? this._dirtyElements.set(e, !0) : this._dirtyLeaves.add(e);
		}, { discrete: !this._updating || void 0 });
	}
	parseEditorState(e, t) {
		return function(e, t, n) {
			let r = hs(), i = Do, a = ko, o = Oo, s = t._dirtyElements, c = t._dirtyLeaves, l = t._cloneNotNeeded, u = t._dirtyType;
			t._dirtyElements = /* @__PURE__ */ new Map(), t._dirtyLeaves = /* @__PURE__ */ new Set(), t._cloneNotNeeded = /* @__PURE__ */ new Map(), t._dirtyType = 0, Do = r, ko = !1, Oo = t, ic(null);
			try {
				let i = t._nodes;
				qo(e.root, i), n && n(), r._readOnly = !0, r._parsed = !0;
			} catch (e) {
				e instanceof Error && t._onError(e);
			} finally {
				t._dirtyElements = s, t._dirtyLeaves = c, t._cloneNotNeeded = l, t._dirtyType = u, Do = i, ko = a, Oo = o;
			}
			return r;
		}(typeof e == "string" ? JSON.parse(e) : e, this, t);
	}
	read(...e) {
		let [t, n] = e.length === 1 ? ["force-commit", e[0]] : e;
		return t === "force-commit" && Yo(this), (t === "pending" ? this._pendingEditorState || this._editorState : this.getEditorState()).read(n, { editor: this });
	}
	update(e, t) {
		(function(e, t, n) {
			e._updating ? e._updates.push([t, n]) : ts(e, t, n);
		})(this, e, t);
	}
	focus(e, t = {}) {
		let n = this._rootElement;
		n !== null && (n.setAttribute("autocapitalize", "off"), ns(this, () => {
			let r = F(), i = Mc();
			r === null ? i.getChildrenSize() !== 0 && (t.defaultSelection === "rootStart" ? i.selectStart() : i.selectEnd()) : r.dirty || Pc(r.clone()), il("focus"), al(() => {
				n.removeAttribute("autocapitalize"), e && e();
			});
		}), this._pendingEditorState === null && n.removeAttribute("autocapitalize"));
	}
	blur() {
		let e = this._rootElement;
		e !== null && e.blur();
		let t = yl(this._window);
		t !== null && t.removeAllRanges();
	}
	isEditable() {
		return this._editable;
	}
	setEditable(e) {
		this._editable !== e && (this._editable = e, Xo("editable", this, !0, e), this._slotsUsed && this.update(() => Vo()));
	}
	toJSON() {
		return { editorState: this._editorState.toJSON(tt()) };
	}
}, rc = null;
function ic(e) {
	rc = e;
}
var ac = Symbol("INTERNAL_SKIP_AFTER_CLONE_FROM"), oc = 1;
function sc(e, t) {
	let n = cc(e, t);
	return n === void 0 && T(30, t), n;
}
function cc(e, t) {
	return e._nodes.get(t);
}
var lc = typeof queueMicrotask == "function" ? queueMicrotask : (e) => {
	Promise.resolve().then(e);
};
function uc(e, t) {
	let n = t === void 0 ? (() => {
		let t = e.getRootNode();
		return vc(t) || xl(t) ? Pl(t) : null;
	})() : t;
	if (!W(n) || n.hasAttribute("data-lexical-slot")) return !1;
	let r = kc(n), i = n.nodeName;
	return Gi(r) && (i === "INPUT" || i === "TEXTAREA" || n.contentEditable === "true" && mc(n) == null);
}
function dc(e, t, n) {
	let r = e.getRootElement();
	if (!r) return !1;
	try {
		if (!t || !r.contains(t) || !r.contains(n)) return !1;
	} catch {
		return !1;
	}
	return pc(t) === e && e.read("latest", () => !uc(t));
}
function fc(e) {
	return e instanceof nc;
}
function pc(e) {
	let t = e;
	for (; t != null;) {
		let e = mc(t);
		if (fc(e)) return e;
		t = el(t);
	}
	return null;
}
function mc(e) {
	return e ? e.__lexicalEditor : null;
}
function hc(e) {
	return Ma(e) || e.isToken();
}
function gc(e) {
	return hc(e) || e.isSegmented();
}
function _c(e) {
	return Il(e) && e.nodeType === 3;
}
function vc(e) {
	return Il(e) && e.nodeType === 9;
}
function yc(e) {
	let t = e;
	for (; t != null;) {
		if (_c(t)) return t;
		t = t.firstChild;
	}
	return null;
}
function bc(e, t, n) {
	let r = ke[t];
	if (n !== null && (e & r) === (n & r)) return e;
	let i = e ^ r;
	return t === "subscript" ? i &= ~ke.superscript : t === "superscript" ? i &= ~ke.subscript : t === "lowercase" ? (i &= ~ke.uppercase, i &= ~ke.capitalize) : t === "uppercase" ? (i &= ~ke.lowercase, i &= ~ke.capitalize) : t === "capitalize" && (i &= ~ke.lowercase, i &= ~ke.uppercase), i;
}
function xc(e, t) {
	let n = function() {
		let e = rc;
		return rc = null, e;
	}();
	if ((t ||= n && n.__key) != null) return void (e.__key = t);
	Lo(), Ro();
	let r = z(), i = zo(), a = "" + oc++;
	i._nodeMap.set(a, e), B(e) ? r._dirtyElements.set(a, !0) : r._dirtyLeaves.add(a), r._cloneNotNeeded.set(a, e), r._dirtyType === 0 && (r._dirtyType = 1), e.__key = a;
}
function Sc(e) {
	Pu(e) !== null && T(380, e.__key, String(Pu(e)));
	let t = e.getParent();
	if (t !== null) {
		let n = e.getWritable(), r = t.getWritable(), i = e.getPreviousSibling(), a = e.getNextSibling(), o = a === null ? null : a.__key, s = i === null ? null : i.__key, c = i === null ? null : i.getWritable(), l = a === null ? null : a.getWritable();
		i === null && (r.__first = o), a === null && (r.__last = s), c !== null && (c.__next = o), l !== null && (l.__prev = s), n.__prev = null, n.__next = null, n.__parent = null, r.__size--;
	}
}
function Cc(e) {
	Ro(), Hi(e) && T(323, e.__key, e.__type);
	let t = e.__parent === null ? Nu(e) ? e.__slotHost : null : e.__parent, n = zo(), r = z(), i = n._nodeMap, a = r._dirtyElements;
	t !== null && function(e, t, n) {
		let r = e;
		for (; r !== null;) {
			if (n.has(r)) return;
			let e = t.get(r);
			if (e === void 0) break;
			n.set(r, !1), r = e.__parent === null ? Nu(e) ? e.__slotHost : null : e.__parent;
		}
	}(t, i, a);
	let o = e.__key;
	r._dirtyType === 0 && (r._dirtyType = 1), B(e) ? a.set(o, !0) : r._dirtyLeaves.add(o);
}
function wc(e) {
	Lo();
	let t = z(), n = t._compositionKey;
	if (e !== n) {
		if (t._compositionKey = e, n !== null) {
			let e = H(n);
			e !== null && e.getWritable();
		}
		if (e !== null) {
			let t = H(e);
			t !== null && t.getWritable();
		}
	}
}
function Tc() {
	return Io() ? null : z()._compositionKey;
}
function H(e, t) {
	let n = (t || zo())._nodeMap.get(e);
	return n === void 0 ? null : n;
}
function Ec(e, t) {
	let n = Oc(e, z());
	return n === void 0 ? null : H(n, t);
}
function Dc(e, t, n) {
	e[`__lexicalKey_${t._key}`] = n;
}
function Oc(e, t) {
	return e[`__lexicalKey_${t._key}`];
}
function kc(e, t) {
	let n = e;
	for (; n != null;) {
		let e = Ec(n, t);
		if (e !== null) return e;
		n = el(n);
	}
	return null;
}
function Ac(e) {
	let t = e._decorators, n = Object.assign({}, t);
	return e._pendingDecorators = n, n;
}
function jc(e) {
	return e.read(() => Mc().getTextContent());
}
function Mc() {
	return zo()._nodeMap.get("root");
}
function Nc(e, t) {
	if (!(fl(e) && e.isAttached() && (ps(e) ? e.getChildrenSize() === 0 : e.isEmpty()) && (ps(e) || t !== null && q(t)))) return null;
	let n = qs();
	return e.append(n), n;
}
function Pc(e) {
	Lo();
	let t = zo();
	e !== null && (e.dirty = !0, e.setCachedNodes(null), P(e) && z()._slotsUsed && ao(e)), t._selection = e;
}
function Fc() {
	Lo(), ft(z());
}
function Ic(e) {
	let t = function(e, t) {
		let n = e;
		for (; n != null;) {
			let e = Oc(n, t);
			if (e !== void 0) return e;
			n = el(n);
		}
		return null;
	}(e, z());
	return t === null ? null : H(t);
}
function Lc(e) {
	return /[\uD800-\uDBFF][\uDC00-\uDFFF]/g.test(e);
}
function Rc(e) {
	let t = [];
	for (let n = e; n !== null; n = n._parentEditor) t.push(n);
	return t;
}
function zc() {
	return Math.random().toString(36).replace(/[^a-z]+/g, "").substring(0, 5);
}
function Bc(e) {
	return _c(e) ? e.nodeValue : null;
}
function Vc(e, t, n) {
	let r = yl(cl(t));
	if (r === null) return;
	let i = kl(r, t._rootElement), a = i.anchorNode, { anchorOffset: o, focusOffset: s } = i;
	if (a !== null) {
		let t = Bc(a), r = kc(a);
		if (t !== null && N(r)) {
			if ((t === Ee || t === Oe) && n) {
				let e = n.length;
				t = n, o = e, s = e;
			}
			t !== null && Hc(r, t, o, s, e);
		}
	}
}
function Hc(e, t, n, r, i) {
	let a = e;
	if (a.isAttached() && (i || !a.isDirty())) {
		let o = a.isComposing();
		if (a.isToken() && o) return;
		let s = t;
		if ((o || i) && (t.endsWith(Ee) && (s = t.slice(0, -Ee.length)), i)) {
			let e = Oe, t;
			for (; (t = s.indexOf(e)) !== -1;) s = s.slice(0, t) + s.slice(t + e.length), n !== null && n > t && (n = Math.max(t, n - e.length)), r !== null && r > t && (r = Math.max(t, r - e.length));
		}
		let c = a.getTextContent();
		if (i || s !== c) {
			let t = F();
			if (s === "") {
				if (wc(null), be || ve || Ce) a.remove();
				else {
					let e = z();
					Uc(a, "", t), setTimeout(() => {
						e.update(() => {
							a.isAttached() && a.getTextContent() === "" && a.remove();
						});
					}, 20);
				}
				return;
			}
			let i = a.getParent(), c = po(), l = a.getTextContentSize(), u = Tc(), d = a.getKey();
			if (a.isToken() && !o || u !== null && d === u && !o || P(c) && (i !== null && !i.canInsertTextBefore() && c.anchor.offset === 0 || c.anchor.key === e.__key && c.anchor.offset === 0 && !a.canInsertTextBefore() && !o || c.focus.key === e.__key && c.focus.offset === l && !a.canInsertTextAfter() && !o)) return void a.markDirty();
			if (!P(t) || n === null || r === null) return void Uc(a, s, t);
			if (t.setTextNodeRange(a, n, a, r), a.isSegmented()) {
				let e = Da(a.getTextContent());
				a.replace(e), a = e;
			}
			Uc(a, s, t);
		}
	}
}
function Uc(e, t, n) {
	if (e.setTextContent(t), P(n)) {
		let t = e.getKey(), r = !1;
		for (let i of ["anchor", "focus"]) {
			let a = n[i];
			a.type === "text" && a.key === t && (a.offset = pd(e, a.offset, "clamp"), r = !0);
		}
		r && (n._cachedNodes = null, n._cachedIsBackward = null);
	}
}
function Wc(e) {
	let t = e;
	for (; t !== null;) {
		let e = t.getParent();
		if (e === null) return null;
		if (ps(e)) return t;
		t = e;
	}
	return null;
}
function Gc(e, t) {
	let { anchor: n, focus: r } = e, i = n.key, a = n.offset, o = n.type, s = r.key, c = r.offset, l = r.type;
	if (rn(e), !ps(t)) return e;
	let u = Wc(n.getNode());
	return B(u) && u.isShadowRoot() && u.is(Wc(r.getNode())) && (n.set(i, a, o), r.set(s, c, l)), e;
}
function Kc(e) {
	let t = Mc();
	if (P(e)) {
		let t = e.anchor, n = e.focus, r = t.getNode();
		if (ps(r)) return t.set(r.getKey(), 0, "element"), n.set(r.getKey(), r.getChildrenSize(), "element"), Gc(e, r), e;
		let i = r.getTopLevelElementOrThrow(), a = i.getParent();
		return a === null ? (B(i) && (t.set(i.getKey(), 0, "element"), n.set(i.getKey(), i.getChildrenSize(), "element"), Gc(e, i)), e) : (t.set(a.getKey(), 0, "element"), n.set(a.getKey(), a.getChildrenSize(), "element"), Gc(e, a), e);
	}
	{
		let e = t.select(0, t.getChildrenSize());
		return Pc(Gc(e, t)), e;
	}
}
function qc(e, t) {
	e.getAttribute(t) === "" && e.removeAttribute(t);
}
function Jc(e, t) {
	e.__lexicalClassNameCache === void 0 && (e.__lexicalClassNameCache = {});
	let n = e.__lexicalClassNameCache, r = n[t];
	if (r !== void 0) return r;
	let i = e[t];
	if (typeof i == "string") {
		let e = Md(i);
		return n[t] = e, e;
	}
	return i;
}
function Yc(e, t, n, r, i) {
	if (n.size === 0) return;
	let a = r.__type, o = r.__key, s = t.get(a);
	s === void 0 && T(33, a);
	let c = s.klass, l = e.get(c);
	l === void 0 && (l = /* @__PURE__ */ new Map(), e.set(c, l));
	let u = l.get(o), d = u === "destroyed" && i === "created";
	(u === void 0 || d) && l.set(o, d ? "updated" : i);
}
function Xc(e, t, n) {
	let r = e.getParent(), i = n, a = e;
	return r !== null && (t && n === 0 ? (i = a.getIndexWithinParent(), a = r) : t || n !== a.getChildrenSize() || (i = a.getIndexWithinParent() + 1, a = r)), a.getChildAtIndex(t ? i - 1 : i);
}
function Zc(e, t) {
	let n = e.offset;
	if (e.type === "element") return Xc(e.getNode(), t, n);
	{
		let r = e.getNode();
		if (t && n === 0 || !t && n === r.getTextContentSize()) {
			let e = t ? r.getPreviousSibling() : r.getNextSibling();
			return e === null ? Xc(r.getParentOrThrow(), t, r.getIndexWithinParent() + +!t) : e;
		}
	}
	return null;
}
function Qc(e) {
	let t = cl(e).event, n = t && t.inputType;
	return n === "insertFromPaste" || n === "insertFromPasteAsQuotation";
}
function U(e, t, ...n) {
	return Qo(e, t, n[0], e);
}
function $c(e, t) {
	let n = e._keyToDOMMap.get(t);
	return n === void 0 && T(75, t), n;
}
function el(e) {
	let t = e.assignedSlot || e.parentElement;
	if (t !== null) return t;
	let n = e.parentNode;
	return xl(n) ? n.host : null;
}
function tl(e) {
	return vc(e) ? e : W(e) ? e.ownerDocument : null;
}
function nl(e, t) {
	let n = parseFloat(e);
	return isFinite(n) ? e.endsWith("%") ? n * t / 100 : n : 0;
}
function rl(e, t, n, r) {
	let i = t.clientWidth, a = t.scrollWidth - i;
	if (a <= 0) return 0;
	let o = e.getComputedStyle(t);
	if (o.overflowX !== "auto" && o.overflowX !== "scroll") return 0;
	let s = t.getBoundingClientRect(), c = t.offsetWidth, l = c > 0 && Math.abs(s.width - c) > 1 ? s.width / c : 1, u = o.direction === "rtl", d = s.left + t.clientLeft * l, f = d + nl(o.scrollPaddingLeft, i) * l, p = d + (i - nl(o.scrollPaddingRight, i)) * l, m = n, h = Math.max(r, n + 1);
	h - m > p - f && (u ? m = h - 1 : h = m + 1);
	let g = 0;
	if (m < f ? g = m - f : h > p && (g = h - p), g === 0) return 0;
	let _ = t.scrollLeft, v = _ + g / l, y = g > 0 ? Math.ceil(v) : Math.floor(v), b = u ? Math.min(0, Math.max(-a, y)) : Math.max(0, Math.min(a, y)), x = _ * l;
	return Math.abs(b) < Math.abs(_) && m + x >= f && h + x <= p && (b = 0), b === _ ? 0 : (t.scrollLeft = b, (t.scrollLeft - _) * l);
}
function il(e) {
	Lo(), z()._updateTags.add(e);
}
function al(e) {
	Lo(), z()._deferred.push(e);
}
function ol(e, t) {
	let n = e.getParent();
	for (; n !== null;) {
		if (n.is(t)) return !0;
		n = n.getParent();
	}
	return !1;
}
function sl(e) {
	let t = tl(e);
	return t ? t.defaultView : null;
}
function cl(e) {
	let t = e._window;
	return t === null && T(78), t;
}
function ll(e) {
	return B(e) && e.isInline() || V(e) && e.isInline();
}
function ul(e) {
	let t = e.getLatest();
	for (; t !== null;) {
		if (Pu(t) !== null && B(t)) return t;
		let e = t.getParentOrThrow();
		if (fl(e)) return e;
		t = e;
	}
	return t;
}
function dl(e) {
	return B(e) && e.isShadowRoot();
}
function fl(e) {
	return ps(e) || dl(e);
}
function pl(e, t = !1) {
	let n = e.constructor.clone(e, ac);
	return xc(n, null), n.afterCloneFrom(e), t || n.resetOnCopyNodeFrom(e), n;
}
function ml(e) {
	let t = z(), n = e.getType(), r = cc(t, n);
	r === void 0 && T(200, e.constructor.name, n);
	let { replace: i, replaceWithKlass: a } = r;
	if (i !== null) {
		let t = i(e), r = t.constructor;
		return a === null ? t instanceof e.constructor && r !== e.constructor || T(202, r.name, r.getType(), e.constructor.name, n) : t instanceof a || T(201, a.name, a.getType(), r.name, r.getType(), e.constructor.name, n), t.__key === e.__key && T(203, e.constructor.name, n, r.name, r.getType()), t;
	}
	return e;
}
function hl(e, t) {
	!ps(e.getParent()) || B(t) || V(t) || T(99);
}
function gl(e) {
	let t = H(e);
	return t === null && T(63, e), t;
}
function _l(e) {
	if (!e || e.isInline()) return !1;
	if (V(e)) return !0;
	if (B(e)) {
		if (e.isShadowRoot()) {
			let t = e.getParent();
			return !(B(t) && t.isShadowRoot());
		}
		return !e.canBeEmpty();
	}
	return !1;
}
function vl(e, t, n) {
	n.style.removeProperty("caret-color"), t._blockCursorElement = null;
	let r = e.parentElement;
	r !== null && r.removeChild(e);
}
function yl(e) {
	return D ? (e || window).getSelection() : null;
}
function bl(e) {
	let t = sl(e);
	return t ? t.getSelection() : null;
}
function xl(e) {
	return Ll(e) && "host" in e;
}
var Sl = [];
function Cl(e) {
	let t = e.getRootNode();
	if (t === e || !xl(t)) return Sl;
	let n = [t], r = t.host;
	for (;;) {
		let e = r.getRootNode();
		if (e === r || !xl(e)) break;
		n.push(e), r = e.host;
	}
	return n;
}
function* wl(e) {
	let t = [e], n;
	for (; n = t.pop();) {
		yield* n.querySelectorAll("[data-lexical-editor=\"true\"]");
		let e = (vc(n) ? n : n.ownerDocument).createTreeWalker(n, NodeFilter.SHOW_ELEMENT), r;
		for (; r = e.nextNode();) r.shadowRoot && t.push(r.shadowRoot);
	}
}
function Tl(e) {
	return e === null ? document : e.ownerDocument;
}
function El() {
	let e = Uo();
	return Tl(e === null ? null : e._rootElement);
}
function Dl(e, t) {
	if (t === null || typeof e.getComposedRanges != "function") return null;
	let n = Cl(t);
	if (n.length === 0) return null;
	let r = e.getComposedRanges;
	try {
		let t = r.call(e, { shadowRoots: n })[0];
		if (t !== void 0) return t;
	} catch {}
	try {
		let t = r.apply(e, n)[0];
		if (t !== void 0) return t;
	} catch {}
	return null;
}
function Ol(e, t) {
	let n = Dl(e, t);
	if (n !== null) {
		let e = Al(n);
		if (e !== null) return e;
	}
	return e.rangeCount > 0 ? e.getRangeAt(0) : null;
}
function kl(e, t) {
	let n = Dl(e, t);
	return n === null ? e : jl(n, Ml(e));
}
function Al(e) {
	let t = e.startContainer.ownerDocument;
	if (t === null) return null;
	let n = t.createRange();
	try {
		return n.setStart(e.startContainer, e.startOffset), n.setEnd(e.endContainer, e.endOffset), n;
	} catch {
		return null;
	}
}
function jl(e, t) {
	let { startContainer: n, startOffset: r, endContainer: i, endOffset: a } = e;
	return t === "backward" ? {
		anchorNode: i,
		anchorOffset: a,
		direction: t,
		focusNode: n,
		focusOffset: r
	} : {
		anchorNode: n,
		anchorOffset: r,
		direction: t,
		focusNode: i,
		focusOffset: a
	};
}
function Ml(e) {
	return e.direction;
}
function Nl(e) {
	let t = e.getRootNode();
	return vc(t) || xl(t) ? t.activeElement : null;
}
function Pl(e) {
	let t = e.activeElement;
	for (; t !== null && t.shadowRoot !== null;) {
		let e = t.shadowRoot.activeElement;
		if (e === null) break;
		t = e;
	}
	return t;
}
function Fl(e) {
	let t = e.target;
	if (t !== null && W(t) && t.shadowRoot !== null && typeof e.composedPath == "function") {
		let t = e.composedPath();
		if (t.length > 0) return t[0];
	}
	return t;
}
function W(e) {
	return Il(e) && e.nodeType === 1;
}
function Il(e) {
	return typeof e == "object" && !!e && "nodeType" in e && typeof e.nodeType == "number";
}
function Ll(e) {
	return Il(e) && e.nodeType === 11;
}
var Rl = /^(a|abbr|acronym|b|cite|code|del|em|i|ins|kbd|label|mark|output|q|ruby|s|samp|span|strong|sub|sup|time|u|tt|var|#text)$/i;
function zl(e) {
	return !(!W(e) || !e.style.display.startsWith("inline")) || Rl.test(e.nodeName);
}
var G = /^(address|article|aside|blockquote|canvas|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h1|h2|h3|h4|h5|h6|header|hr|li|main|nav|noscript|ol|p|pre|section|table|td|tfoot|ul|video)$/i;
function K(e) {
	return (!W(e) || !e.style.display.startsWith("inline")) && G.test(e.nodeName);
}
function q(e) {
	if (V(e) && !e.isInline()) return !0;
	if (!B(e) || fl(e)) return !1;
	let t = e.getFirstChild(), n = t === null || Cs(t) || N(t) || t.isInline();
	return !e.isInline() && !1 !== e.canBeEmpty() && n;
}
function J() {
	return z();
}
function Y(e = J()) {
	return e._config.dom || Qs;
}
function Bl(e, t, n = J()) {
	let r = Y(n).$getDOMSlot(e, t, n);
	return B(e) && (Vl(r) || T(344, e.getKey(), e.getType())), r;
}
function Vl(e) {
	return e instanceof Ge;
}
function Hl(e, t, n = J()) {
	return yc(Bl(e, t, n).element);
}
var Ul = /* @__PURE__ */ new WeakMap(), Wl = /* @__PURE__ */ new Map();
function Gl(e) {
	if (!e._readOnly && e.isEmpty()) return Wl;
	e._readOnly || T(192);
	let t = Ul.get(e);
	return t || (t = function(e) {
		let t = /* @__PURE__ */ new Map();
		for (let [n, r] of e._nodeMap) {
			let e = r.__type, i = t.get(e);
			i || (i = /* @__PURE__ */ new Map(), t.set(e, i)), i.set(n, r);
		}
		return t;
	}(e), Ul.set(e, t)), t;
}
function Kl(e) {
	let t = e.constructor.clone(e, ac);
	return t.afterCloneFrom(e), t;
}
function ql(e) {
	return (t = Kl(e))[M] = !0, t;
	var t;
}
function Jl(e, t) {
	let n = e.getAttribute("data-lexical-indent");
	if (n !== null) {
		let e = parseInt(n, 10);
		if (Number.isFinite(e) && e >= 0) return void t.setIndent(e);
	}
	let r = parseInt(e.style.paddingInlineStart, 10) || 0, i = Math.round(r / 40);
	t.setIndent(i);
}
function Yl(e, t) {
	let n = t.getAttribute("dir");
	return n === "ltr" || n === "rtl" ? e.setDirection(n) : e;
}
function Xl(e, t) {
	let n = t.style.textAlign;
	return n && n in je ? e.setFormat(n) : e;
}
function Zl(e, t) {
	e.__lexicalUnmanaged = !0, t && t.captureSelection !== void 0 && (e.__lexicalCapturedSelection = t.captureSelection);
}
function Ql(e) {
	return !0 === e.__lexicalUnmanaged;
}
function $l(e, t = J()) {
	let n = t.isEditable();
	e.contentEditable = n ? "true" : "false", n ? e.__lexicalEditor = t : delete e.__lexicalEditor;
}
function eu(e, t) {
	let n = e;
	for (; n != null;) {
		if (!0 === n.__lexicalCapturedSelection) return !0;
		if (W(n) && n.hasAttribute("data-lexical-slot") || Oc(n, t) !== void 0) return !1;
		n = el(n);
	}
	return !1;
}
function tu(e, t) {
	return kt(e, t) && e[t] !== Wi[t];
}
var nu = /* @__PURE__ */ new WeakMap();
function ru(e) {
	let t = nu.get(e);
	return t === void 0 ? function(e) {
		let t = e.prototype != null && Le in e.prototype ? e.prototype[Le]() : void 0, n = function(e) {
			if (!(e === Wi || e.prototype instanceof Wi)) {
				let t = "<unknown>", n = "<unknown>";
				try {
					t = e.getType();
				} catch {}
				try {
					nc.version && (n = JSON.parse(nc.version));
				} catch {}
				T(290, e.name, t, n);
			}
			return e === ds || e === ls || e === Wi;
		}(e), r = !n && tu(e, "getType") ? e.getType : void 0, i = r && !(au in r) ? r.call(e) : void 0, a, o = i;
		if (t) {
			if (i) a = t[i];
			else {
				for (let [e, n] of Object.entries(t)) o = e, a = n;
				if (!a) for (let e of Object.getOwnPropertySymbols(t)) {
					let n = t[e];
					if (n) {
						a = n;
						break;
					}
				}
			}
		}
		let s = {
			compiled: void 0,
			composed: void 0,
			config: {
				declaresOwnConfig: kt(e.prototype, Le),
				klass: e,
				ownNodeConfig: a,
				ownNodeType: o
			},
			ownFieldsValidated: !1
		};
		nu.set(e, s);
		try {
			let t = function(e) {
				let t = e.prototype, n = /* @__PURE__ */ new Map(), { fieldsBaseFirst: r } = fu(e);
				for (let [i, a] of r) {
					let r = hu(e, i, a);
					if (r === null) continue;
					if (gt(r)) {
						let t = r.field;
						if (t === "__proto__" && T(430, e.name, i), r.setterTable !== void 0) {
							let { setterTable: t } = r, { meta: n } = a;
							for (let r of n.kind === "enum" ? n.values : [a.defaultValue]) kt(t, String(r)) || T(431, e.name, i, JSON.stringify(r));
						}
						n.set(i, {
							field: t,
							key: i,
							kind: "ownField",
							schema: a,
							setterTable: r.setterTable
						});
						continue;
					}
					let o = t[r];
					typeof o != "function" && T(432, e.name, i, r), n.set(i, {
						key: i,
						kind: "field",
						schema: a,
						setter: o
					});
				}
				return n.size === 0 ? ou : [...n.values()];
			}(e), r = function(e) {
				let t = e.prototype, n = /* @__PURE__ */ new Map();
				for (let [r, i] of fu(e).fieldsDerivedFirst) {
					let a = mu(e, r, i);
					if (a === null) continue;
					if (gt(a)) {
						let o = a.field;
						o === "__proto__" && T(426, e.name, r);
						let s = a.when, c;
						if (s !== void 0) {
							let n = t[s];
							typeof n != "function" && T(427, e.name, r, s), c = n;
						}
						n.set(r, {
							defaultValue: i.defaultValue,
							derived: i.setter === null,
							field: o,
							getterTable: a.getterTable,
							isEqual: i.isEqual,
							key: r,
							kind: "ownField",
							schema: i,
							when: c
						});
						continue;
					}
					let o = t[a];
					typeof o != "function" && T(428, e.name, r, a), n.set(r, {
						defaultValue: i.defaultValue,
						derived: i.setter === null,
						getter: o,
						isEqual: i.isEqual,
						key: r,
						kind: "method",
						schema: i
					});
				}
				return n.size === 0 ? pu : [...n.values()];
			}(e), i = fu(e), c = function(e, t, n) {
				let r, i = e;
				for (let { klass: t, ownNodeConfig: n } of Eu(e)) n && n.generated !== void 0 && (r === void 0 ? (r = n.generated, i = t) : n.generated === r && (i = t));
				return r === void 0 ? null : i === e || function(e, t) {
					if (e.getters.length !== t.getters.length || e.setters.length !== t.setters.length) return !1;
					for (let n = 0; n < e.getters.length; n++) {
						let r = e.getters[n], i = t.getters[n];
						if (r.kind !== i.kind || r.key !== i.key || r.schema !== i.schema || r.derived !== i.derived || r.isEqual !== i.isEqual || !Object.is(r.defaultValue, i.defaultValue) || r.kind === "ownField" && i.kind === "ownField" && (r.field !== i.field || r.getterTable === void 0 != (i.getterTable === void 0))) return !1;
					}
					for (let n = 0; n < e.setters.length; n++) {
						let r = e.setters[n], i = t.setters[n];
						if (r.kind !== i.kind || r.key !== i.key || r.schema !== i.schema || r.kind === "ownField" && i.kind === "ownField" && (r.field !== i.field || r.setterTable === void 0 != (i.setterTable === void 0))) return !1;
					}
					return !0;
				}(n, iu(ru(i))) ? r : null;
			}(e, 0, {
				getters: r,
				setters: t
			});
			s.compiled = {
				flatStates: i.flatStates,
				generated: c === null ? null : c(i.fields),
				getters: r,
				isCompactDefault: vu(r),
				setters: t
			}, function(e, t, n, r) {
				if (!t && n) {
					if (!tu(e, "getType")) {
						let t = e, r = function() {
							return this === t ? n : Wi.getType.call(this);
						};
						r[au] = !0, e.getType = r;
					}
					if (tu(e, "clone") || (e.clone = (t, n) => {
						ic(t);
						let r = new e();
						return n !== ac && r.afterCloneFrom(t), r;
					}), tu(e, "importJSON") || (e.importJSON = r && r.$importJSON || function(e) {
						return (t) => {
							let n = Du(e);
							return n.updateFromJSON === Wi.prototype.updateFromJSON ? function(e, t) {
								return bu(e.__state || t.$ !== void 0 ? Jt(e, t) : e, t);
							}(n, t) : n.updateFromJSON(t);
						};
					}(e)), !tu(e, "importDOM") && r) {
						let { importDOM: t } = r;
						t && (e.importDOM = () => t);
					}
				}
			}(e, n, o, a), function(e) {
				for (let { klass: t, ownNodeConfig: n } of Eu(e)) {
					let e = t.prototype;
					if (kt(e, "afterCloneFrom")) continue;
					let r = Tu(t);
					if (r.length === 0) continue;
					let i = Object.getPrototypeOf(e), a = n && n.generated !== void 0 ? iu(ru(t)).generated : null, o = a !== null && a.afterCloneFrom || ((e, t) => {
						let n = e, i = t;
						for (let e = 0; e < r.length; e++) {
							let t = r[e];
							n[t] = i[t];
						}
					});
					e.afterCloneFrom = function(e) {
						i.afterCloneFrom.call(this, e), o(this, e);
					}, e.afterCloneFrom[Cu] = !0;
				}
			}(e);
		} catch (t) {
			throw nu.delete(e), t;
		}
		return s;
	}(e) : t;
}
function iu(e) {
	let { compiled: t } = e;
	return t === void 0 && T(422, e.config.klass.name), t;
}
var au = Symbol("lexical.synthesizedGetType"), ou = [];
function su(e, t, n, r) {
	let i = n.method === void 0 ? r : n.method, a = fu(e).declaredBy.get(t);
	if (a === void 0) return n;
	let o = e.prototype, s = a.prototype;
	return cu(o, s, i) && cu(o, s, r) ? n : i;
}
function cu(e, t, n) {
	return e[n] === t[n];
}
function lu(e) {
	return `set${e.charAt(0).toUpperCase()}${e.slice(1)}`;
}
function uu(e) {
	return `get${e.charAt(0).toUpperCase()}${e.slice(1)}`;
}
var du = {
	declaredBy: /* @__PURE__ */ new Map(),
	fields: /* @__PURE__ */ new Map(),
	fieldsBaseFirst: [],
	fieldsDerivedFirst: [],
	flatStates: []
};
function fu(e) {
	let t = ru(e);
	return t.composed === void 0 && (t.composed = function(e) {
		let t = [], n = [], r = [];
		for (let { klass: i, ownNodeConfig: a } of Eu(e)) {
			let e = a && a.json;
			n.push(i), t.push(e && e.meta.kind === "node" ? Object.entries(e.meta.fields) : []);
			let o = [];
			if (a && a.stateConfigs) for (let e of a.stateConfigs) "stateConfig" in e && e.flat && o.push(e.stateConfig);
			r.push(o);
		}
		let i = /* @__PURE__ */ new Map();
		for (let e = 0; e < t.length; e++) for (let [n, r] of t[e]) i.has(n) || i.set(n, r);
		let a = /* @__PURE__ */ new Map(), o = /* @__PURE__ */ new Map(), s = /* @__PURE__ */ new Map();
		for (let e = t.length - 1; e >= 0; e--) {
			for (let [r, s] of t[e]) {
				let t = i.get(r);
				t === void 0 || a.has(r) || a.set(r, t), t === void 0 || s !== t || o.has(r) || o.set(r, n[e]);
			}
			for (let t of r[e]) s.has(t.key) || s.set(t.key, t);
		}
		return i.size === 0 && s.size === 0 ? du : {
			declaredBy: o,
			fields: a,
			fieldsBaseFirst: [...a],
			fieldsDerivedFirst: [...i],
			flatStates: [...s.values()]
		};
	}(e)), t.composed;
}
var pu = [];
function mu(e, t, n) {
	let r = n.getter;
	if (r === null) return null;
	let i = r === void 0 ? uu(t) : r;
	return gt(i) ? su(e, t, i, uu(t)) : i;
}
function hu(e, t, n) {
	let r = n.setter;
	if (r === null) return null;
	let i = r === void 0 ? lu(t) : r;
	return gt(i) ? su(e, t, i, lu(t)) : i;
}
function gu(e) {
	return e;
}
function _u(e, t) {
	let { defaultValue: n, isEqual: r } = e;
	return t === void 0 || t === n || r !== void 0 && r(t, n);
}
function vu(e) {
	let t;
	return (n, r) => {
		t === void 0 && (t = new Map(e.map((e) => [e.key, e])));
		let i = t.get(n);
		return i !== void 0 && _u(i, r);
	};
}
function yu(e) {
	let { setterTable: t, schema: n } = e, { defaultValue: r } = n;
	return t === void 0 ? r : t[String(r)];
}
function bu(e, t) {
	let { flatStates: n, generated: r, setters: i } = iu(ru(e.constructor)), a = function(e, t, n) {
		let r = e;
		for (let e = 0; e < n.length; e++) {
			let i = n[e], a = t[i.key];
			if (a !== void 0) {
				let e = i.parse(a);
				r = Ut(r, i, () => e);
			}
		}
		return r;
	}(e, t, n);
	return r !== null && r.updateFromJSON !== void 0 ? r.updateFromJSON(a, t) : function(e, t, n) {
		for (let r = 0; r < n.length; r++) {
			let i = n[r], a = i.schema(t[i.key]);
			i.kind === "ownField" ? gu(e)[i.field] = i.setterTable === void 0 ? a : kt(i.setterTable, a) ? i.setterTable[a] : yu(i) : i.setter.call(e, a);
		}
		return e;
	}(a, t, i);
}
function xu(e) {
	return ru(e).config;
}
function Su(e) {
	let t = [];
	for (let n of [e.getter, e.setter]) gt(n) && n.field !== "__proto__" && !t.includes(n.field) && t.push(n.field);
	return t;
}
var Cu = "__lexicalSynthesizedAfterCloneFrom";
function wu(e) {
	let { declaredBy: t, fieldsBaseFirst: n } = fu(e), r = [];
	for (let [i, a] of n) if (t.get(i) === e) for (let e of Su(a)) r.includes(e) || r.push(e);
	return r;
}
function Tu(e) {
	let t = wu(e);
	if (t.length === 0) return t;
	let n = /* @__PURE__ */ new Set();
	for (let { klass: t } of Eu(e)) if (t !== e) for (let e of wu(t)) n.add(e);
	return n.size === 0 ? t : t.filter((e) => !n.has(e));
}
function* Eu(e) {
	for (let t = e; t && (t === Wi || Gi(t.prototype));) {
		let e = xu(t), n = e.declaresOwnConfig;
		yield n ? e : {
			...e,
			ownNodeConfig: void 0
		}, t = n && e.ownNodeConfig && e.ownNodeConfig.extends || Au(t);
	}
}
function Du(e) {
	let t = J();
	Lo();
	let n = t.resolveRegisteredNodeAfterReplacements(t.getRegisteredNode(e)), r = new n.klass();
	return n.replace === null ? r : ml(r);
}
var Ou = (e, t) => {
	let n = e;
	for (; n != null && !ps(n);) {
		if (t(n)) return n;
		n = n.getParent();
	}
	return null;
};
function ku(e, t) {
	let n = [], r = e.__first;
	for (; r !== null;) {
		let e = t === null ? H(r) : t.get(r);
		e ?? T(174), n.push(r), r = e.__next;
	}
	return n;
}
function Au(e) {
	let t = Object.getPrototypeOf(e);
	if (typeof t == "function" && t !== Function.prototype) return t;
	let n = e.prototype && Object.getPrototypeOf(e.prototype);
	return n ? n.constructor : null;
}
var ju = /* @__PURE__ */ new Map();
function Mu(e) {
	return B(e) || V(e);
}
function Nu(e) {
	return B(e) || V(e);
}
function Pu(e) {
	let t = e.getLatest();
	return Nu(t) ? t.__slotHost : null;
}
function Fu(e) {
	let t = Pu(e);
	if (t === null) return null;
	let n = H(t);
	return B(n) || V(n) || T(370), n;
}
function Iu(e) {
	let t = Fu(e);
	if (t === null) return null;
	let n = e.getLatest().__key;
	for (let [e, r] of zu(t)) if (r === n) return e;
	return null;
}
function Lu(e) {
	let t = e.getLatest();
	for (; t !== null;) {
		if (Pu(t) !== null) return t;
		t = t.getParent();
	}
	return null;
}
function Ru(e) {
	if (e === null) return null;
	let t = P(e) ? e.anchor.getNode() : e.getNodes()[0] ?? null;
	return t === null ? null : Lu(t);
}
function zu(e) {
	let t = e.getLatest();
	return Mu(t) && t.__slots !== null ? t.__slots : ju;
}
function Bu(e) {
	return Array.from(zu(e).keys());
}
function Vu(e, t) {
	let n = zu(e).get(t);
	return n === void 0 ? null : H(n);
}
var Hu = [
	"__proto__",
	"constructor",
	"prototype"
], Uu = Symbol("slotMapOwner");
function Wu(e) {
	let t = e.__slots;
	return t !== null && t[Uu] === e || (t = new Map(t), t[Uu] = e, e.__slots = t), t;
}
var Gu = /* @__PURE__ */ new WeakMap(), X = [];
function Ku(e) {
	for (let { ownNodeConfig: t } of Eu(e)) {
		let e = t && t.slots;
		if (e) return e;
	}
	return X;
}
function qu(e) {
	let t = "";
	for (let n of Bu(e)) {
		let r = Vu(e, n);
		r !== null && (t += r.getTextContent());
	}
	return t;
}
function Ju(e, t, n) {
	let r = n.get(e), i = n.get(t);
	return r === void 0 ? i === void 0 ? e < t ? -1 : +(e > t) : 1 : i === void 0 ? -1 : r - i;
}
function Yu(e, t, n) {
	t !== "__proto__" && t !== "constructor" && t !== "prototype" || T(373, t);
	let r = e.getLatest();
	if (r.__slots !== null && r.__slots.get(t) === n.getLatest().__key) return r;
	(!B(n) && !V(n) || n.isInline()) && T(374, n.__key);
	let i = e.getWritable(), a = Wu(i), o = a.get(t);
	o !== void 0 && Xu(o);
	let s = n.getWritable(), c = Fu(s);
	if (c !== null) {
		let e = Iu(s);
		e !== null && Wu(c.getWritable()).delete(e), s.__slotHost = null;
	}
	return Sc(s), s.__slotHost = i.__key, a.set(t, s.__key), function(e) {
		let t = e.__slots;
		if (t === null || t.size < 2) return;
		let n = function(e) {
			let t = Gu.get(e);
			if (t === void 0) {
				let n = Ku(e), r = /* @__PURE__ */ new Map();
				for (let t of n) Hu.includes(t) && T(371, e.name, t), r.has(t) && T(372, e.name, t), r.set(t, r.size);
				t = r, Gu.set(e, t);
			}
			return t;
		}(e.constructor), r = null, i = !0;
		for (let e of t.keys()) {
			if (r !== null && Ju(r, e, n) > 0) {
				i = !1;
				break;
			}
			r = e;
		}
		if (i) return;
		let a = Array.from(t).sort(([e], [t]) => Ju(e, t, n));
		t.clear();
		for (let [e, n] of a) t.set(e, n);
	}(i), z()._slotsUsed = !0, zo()._slotsUsed = !0, i;
}
function Xu(e) {
	let t = H(e);
	if (t === null) return;
	let n = t.getWritable();
	Nu(n) || T(377, e), n.__slotHost = null, n.remove();
}
var Zu = {
	next: "previous",
	previous: "next"
}, Qu = class {
	origin;
	constructor(e) {
		this.origin = e;
	}
	[Symbol.iterator]() {
		return Cd({
			hasNext: od,
			initial: this.getAdjacentCaret(),
			map: (e) => e,
			step: (e) => e.getAdjacentCaret()
		});
	}
	getAdjacentCaret() {
		return dd(this.getNodeAtCaret(), this.direction);
	}
	getSiblingCaret() {
		return dd(this.origin, this.direction);
	}
	remove() {
		let e = this.getNodeAtCaret();
		return e && e.remove(), this;
	}
	replaceOrInsert(e, t) {
		let n = this.getNodeAtCaret();
		return e.is(this.origin) || e.is(n) || (n === null ? this.insert(e) : n.replace(e, t)), this;
	}
	splice(e, t, n = "next") {
		let r = n === this.direction ? t : Array.from(t).reverse(), i = this, a = this.getParentAtCaret(), o = /* @__PURE__ */ new Map();
		for (let t = i.getAdjacentCaret(); t !== null && o.size < e; t = t.getAdjacentCaret()) {
			let e = t.origin.getWritable();
			o.set(e.getKey(), e);
		}
		for (let e of r) {
			if (o.size > 0) {
				let t = i.getNodeAtCaret();
				if (t) {
					if (o.delete(t.getKey()), o.delete(e.getKey()), !(t.is(e) || i.origin.is(e))) {
						let n = e.getParent();
						n && n.is(a) && e.remove(), t.replace(e);
					}
				} else t === null && T(263, Array.from(o).join(" "));
			} else i.insert(e);
			i = dd(e, this.direction);
		}
		for (let e of o.values()) e.remove();
		return this;
	}
}, $u = class e extends Qu {
	type = "child";
	getLatest() {
		let e = this.origin.getLatest();
		return e === this.origin ? this : hd(e, this.direction);
	}
	getParentCaret(e = "root") {
		return dd(nd(this.getParentAtCaret(), e), this.direction);
	}
	getFlipped() {
		let e = td(this.direction);
		return dd(this.getNodeAtCaret(), e) || hd(this.origin, e);
	}
	getParentAtCaret() {
		return this.origin;
	}
	getChildCaret() {
		return this;
	}
	isSameNodeCaret(t) {
		return t instanceof e && this.direction === t.direction && this.origin.is(t.origin);
	}
	isSamePointCaret(e) {
		return this.isSameNodeCaret(e);
	}
}, ed = {
	root: ps,
	shadowRoot: fl
};
function td(e) {
	return Zu[e];
}
function nd(e, t = "root") {
	return e === null || ed[t](e) ? null : Pu(e) === null ? e : null;
}
var rd = class e extends Qu {
	type = "sibling";
	getLatest() {
		let e = this.origin.getLatest();
		return e === this.origin ? this : dd(e, this.direction);
	}
	getSiblingCaret() {
		return this;
	}
	getParentAtCaret() {
		return this.origin.getParent();
	}
	getChildCaret() {
		return B(this.origin) ? hd(this.origin, this.direction) : null;
	}
	getParentCaret(e = "root") {
		return dd(nd(this.getParentAtCaret(), e), this.direction);
	}
	getFlipped() {
		let e = td(this.direction);
		return dd(this.getNodeAtCaret(), e) || hd(this.origin.getParentOrThrow(), e);
	}
	isSamePointCaret(t) {
		return t instanceof e && this.direction === t.direction && this.origin.is(t.origin);
	}
	isSameNodeCaret(t) {
		return (t instanceof e || t instanceof id) && this.direction === t.direction && this.origin.is(t.origin);
	}
}, id = class e extends Qu {
	type = "text";
	offset;
	constructor(e, t) {
		super(e), this.offset = t;
	}
	getLatest() {
		let e = this.origin.getLatest();
		return e === this.origin ? this : fd(e, this.direction, this.offset);
	}
	getParentAtCaret() {
		return this.origin.getParent();
	}
	getChildCaret() {
		return null;
	}
	getParentCaret(e = "root") {
		return dd(nd(this.getParentAtCaret(), e), this.direction);
	}
	getFlipped() {
		return fd(this.origin, td(this.direction), this.offset);
	}
	isSamePointCaret(t) {
		return t instanceof e && this.direction === t.direction && this.origin.is(t.origin) && this.offset === t.offset;
	}
	isSameNodeCaret(t) {
		return (t instanceof rd || t instanceof e) && this.direction === t.direction && this.origin.is(t.origin);
	}
	getSiblingCaret() {
		return dd(this.origin, this.direction);
	}
};
function ad(e) {
	return e instanceof id;
}
function od(e) {
	return e instanceof rd;
}
function sd(e) {
	return e instanceof $u;
}
var cd = {
	next: class extends id {
		direction = "next";
		getNodeAtCaret() {
			return this.origin.getNextSibling();
		}
		insert(e) {
			return this.origin.insertAfter(e), this;
		}
	},
	previous: class extends id {
		direction = "previous";
		getNodeAtCaret() {
			return this.origin.getPreviousSibling();
		}
		insert(e) {
			return this.origin.insertBefore(e), this;
		}
	}
}, ld = {
	next: class extends rd {
		direction = "next";
		getNodeAtCaret() {
			return this.origin.getNextSibling();
		}
		insert(e) {
			return this.origin.insertAfter(e), this;
		}
	},
	previous: class extends rd {
		direction = "previous";
		getNodeAtCaret() {
			return this.origin.getPreviousSibling();
		}
		insert(e) {
			return this.origin.insertBefore(e), this;
		}
	}
}, ud = {
	next: class extends $u {
		direction = "next";
		getNodeAtCaret() {
			return this.origin.getFirstChild();
		}
		insert(e) {
			return this.origin.splice(0, 0, [e]), this;
		}
	},
	previous: class extends $u {
		direction = "previous";
		getNodeAtCaret() {
			return this.origin.getLastChild();
		}
		insert(e) {
			return this.origin.splice(this.origin.getChildrenSize(), 0, [e]), this;
		}
	}
};
function dd(e, t) {
	return e ? new ld[t](e) : null;
}
function fd(e, t, n) {
	return e ? new cd[t](e, pd(e, n)) : null;
}
function pd(e, t, n = "error") {
	let r = e.getTextContentSize(), i = t === "next" ? r : t === "previous" ? 0 : t;
	return (i < 0 || i > r) && (n !== "clamp" && le(284, String(t), String(r), e.getKey()), i = i < 0 ? 0 : r), i;
}
function md(e, t) {
	return new yd(e, t);
}
function hd(e, t) {
	return B(e) ? new ud[t](e) : null;
}
function gd(e) {
	return e && e.getChildCaret() || e;
}
function _d(e) {
	return e && gd(e.getAdjacentCaret());
}
var vd = class e {
	type = "node-caret-range";
	direction;
	anchor;
	focus;
	constructor(e, t, n) {
		this.anchor = e, this.focus = t, this.direction = n;
	}
	getLatest() {
		let t = this.anchor.getLatest(), n = this.focus.getLatest();
		return t === this.anchor && n === this.focus ? this : new e(t, n, this.direction);
	}
	isCollapsed() {
		return this.anchor.isSamePointCaret(this.focus);
	}
	getTextSlices() {
		let e = (e) => {
			let t = this[e].getLatest();
			return ad(t) ? function(e, t) {
				let { direction: n, origin: r } = e;
				return md(e, pd(r, t === "focus" ? td(n) : n) - e.offset);
			}(t, e) : null;
		}, t = e("anchor"), n = e("focus");
		if (t && n) {
			let { caret: e } = t, { caret: r } = n;
			if (e.isSameNodeCaret(r)) return [md(e, r.offset - e.offset), null];
		}
		return [t, n];
	}
	iterNodeCarets(e = "root") {
		let t = ad(this.anchor) ? this.anchor.getSiblingCaret() : this.anchor.getLatest(), n = this.focus.getLatest(), r = ad(n), i = (t) => t.isSameNodeCaret(n) ? null : _d(t) || t.getParentCaret(e);
		return Cd({
			hasNext: (e) => e !== null && !(r && n.isSameNodeCaret(e)),
			initial: t.isSameNodeCaret(n) ? null : i(t),
			map: (e) => e,
			step: i
		});
	}
	[Symbol.iterator]() {
		return this.iterNodeCarets("root");
	}
}, yd = class {
	type = "slice";
	caret;
	distance;
	constructor(e, t) {
		this.caret = e, this.distance = t;
	}
	getSliceIndices() {
		let { distance: e, caret: { offset: t } } = this, n = t + e;
		return n < t ? [n, t] : [t, n];
	}
	getTextContent() {
		let [e, t] = this.getSliceIndices();
		return this.caret.origin.getTextContent().slice(e, t);
	}
	getTextContentSize() {
		return Math.abs(this.distance);
	}
	removeTextSlice() {
		let { caret: { origin: e, direction: t } } = this, [n, r] = this.getSliceIndices(), i = e.getTextContent();
		return fd(e.setTextContent(i.slice(0, n) + i.slice(r)), t, n);
	}
};
function bd(e, t) {
	return e.direction === t ? e : e.getFlipped();
}
function Z(e) {
	return Sd(e, bd(hd(Mc(), td(e.direction)), e.direction));
}
function xd(e) {
	return Sd(e, e);
}
function Sd(e, t) {
	return e.direction !== t.direction && T(265), new vd(e, t, e.direction);
}
function Cd(e) {
	let { initial: t, hasNext: n, step: r, map: i } = e, a = t;
	return {
		[Symbol.iterator]() {
			return this;
		},
		next() {
			if (!n(a)) return {
				done: !0,
				value: void 0
			};
			let e = {
				done: !1,
				value: i(a)
			};
			return a = r(a), e;
		}
	};
}
function wd(e, t) {
	let n = Od(e.origin, t.origin);
	switch (n === null && T(275, e.origin.getKey(), t.origin.getKey()), n.type) {
		case "same": {
			let n = e.type === "text", r = t.type === "text";
			return n && r ? function(e, t) {
				return Math.sign(e - t);
			}(e.offset, t.offset) : e.type === t.type ? 0 : n ? -1 : r ? 1 : e.type === "child" ? -1 : 1;
		}
		case "ancestor": return e.type === "child" ? -1 : 1;
		case "descendant": return t.type === "child" ? 1 : -1;
		case "branch": return Td(n);
	}
}
function Td(e) {
	let { a: t, b: n } = e, r = t.__key, i = n.__key, a = t, o = n;
	for (; a && o; a = a.getNextSibling(), o = o.getNextSibling()) {
		if (a.__key === i) return -1;
		if (o.__key === r) return 1;
	}
	return a === null ? 1 : -1;
}
function Ed(e, t) {
	return t.is(e);
}
function Dd(e) {
	return B(e) ? [e.getLatest(), null] : [e.getParent(), e.getLatest()];
}
function Od(e, t) {
	if (e.is(t)) return {
		commonAncestor: e,
		type: "same"
	};
	let n = /* @__PURE__ */ new Map();
	for (let [t, r] = Dd(e); t; r = t, t = t.getParent()) n.set(t, r);
	for (let [r, i] = Dd(t); r; i = r, r = r.getParent()) {
		let a = n.get(r);
		if (a !== void 0) return a === null ? (Ed(e, r) || T(276), {
			commonAncestor: r,
			type: "ancestor"
		}) : i === null ? (Ed(t, r) || T(277), {
			commonAncestor: r,
			type: "descendant"
		}) : ((B(a) || Ed(e, a)) && (B(i) || Ed(t, i)) && r.is(a.getParent()) && r.is(i.getParent()) || T(278), {
			a,
			b: i,
			commonAncestor: r,
			type: "branch"
		});
	}
	return null;
}
function kd(e) {
	return e;
}
function Ad(...e) {
	return e;
}
function jd(e, t) {
	if (!t || e === t) return e;
	for (let n in t) if (e[n] !== t[n]) return {
		...e,
		...t
	};
	return e;
}
function Md(...e) {
	let t = [];
	for (let n of e) if (n && typeof n == "string") for (let [e] of n.matchAll(/\S+/g)) t.push(e);
	return t;
}
function Nd(...e) {
	return () => {
		for (let t = e.length - 1; t >= 0; t--) e[t]();
		e.length = 0;
	};
}
function Q(e, t, n) {
	return Nd(...Object.entries(t).map(([t, r]) => ti(e, t, r, n)));
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/react@19.2.8/node_modules/react/cjs/react-jsx-runtime.production.js
var Pd = /* @__PURE__ */ e(((e) => {
	var t = Symbol.for("react.transitional.element"), n = Symbol.for("react.fragment");
	function r(e, n, r) {
		var i = null;
		if (r !== void 0 && (i = "" + r), n.key !== void 0 && (i = "" + n.key), "key" in n) for (var a in r = {}, n) a !== "key" && (r[a] = n[a]);
		else r = n;
		return n = r.ref, {
			$$typeof: t,
			type: e,
			key: i,
			ref: n === void 0 ? null : n,
			props: r
		};
	}
	e.Fragment = n, e.jsx = r, e.jsxs = r;
})), $ = (/* @__PURE__ */ e(((e, t) => {
	t.exports = Pd();
})))(), Fd = Object.freeze({
	chips: "tmt-ui-chips",
	chip: "tmt-ui-chip",
	chipLabel: "tmt-ui-chip-label",
	chipsAdd: "tmt-ui-chips-add",
	chipsStatus: "tmt-ui-chips-status",
	chipsSurface: "tmt-ui-chips-surface",
	chipsSearch: "tmt-ui-chips-search",
	chipsOption: "tmt-ui-chips-option",
	countChip: "tmt-ui-count-chip",
	count: "tmt-ui-count",
	avatar: "tmt-ui-avatar",
	radio: "tmt-ui-radio",
	choices: "tmt-ui-choices",
	choicesLegend: "tmt-ui-choices-legend",
	choice: "tmt-ui-choice",
	choiceText: "tmt-ui-choice-text",
	choiceDescription: "tmt-ui-choice-description",
	choiceHint: "tmt-ui-choice-hint",
	pager: "tmt-ui-pager",
	pagerPosition: "tmt-ui-pager-position",
	statusTiles: "tmt-ui-status-tiles",
	statusTile: "tmt-ui-status-tile",
	statusTileLabel: "tmt-ui-status-tile-label",
	statusTileValue: "tmt-ui-status-tile-value",
	statusTileDot: "tmt-ui-status-tile-dot",
	stateMark: "tmt-ui-state-mark",
	card: "tmt-ui-card",
	cardHead: "tmt-ui-card-head",
	cardTitle: "tmt-ui-card-title",
	cardMeta: "tmt-ui-card-meta",
	meter: "tmt-ui-meter",
	meterFill: "tmt-ui-meter-fill",
	glyph: "tmt-ui-glyph",
	page: "tmt-ui-page",
	pageHead: "tmt-ui-page-head",
	pageTitle: "tmt-ui-page-title",
	topBarTitlePrefix: "tmt-ui-topbar-title-prefix",
	topBarTitleCurrent: "tmt-ui-topbar-title-current",
	topBarTitleChips: "tmt-ui-topbar-title-chips",
	pageSubtitle: "tmt-ui-page-subtitle",
	stats: "tmt-ui-stats",
	stat: "tmt-ui-stat",
	statValue: "tmt-ui-stat-value",
	statNumber: "tmt-ui-stat-number",
	statCaption: "tmt-ui-stat-caption",
	banner: "tmt-ui-banner",
	bannerHead: "tmt-ui-banner-head",
	bannerRow: "tmt-ui-banner-row",
	facts: "tmt-ui-facts",
	tableScroll: "tmt-ui-table-scroll",
	tableGroup: "tmt-ui-table-group",
	tableGroupToggle: "tmt-ui-table-group-toggle",
	tableGroupCount: "tmt-ui-table-group-count",
	tableSelect: "tmt-ui-table-select",
	tableCompactMeta: "tmt-ui-table-compact-meta",
	tableMono: "tmt-ui-table-mono",
	tableQuiet: "tmt-ui-table-quiet",
	avatarStack: "tmt-ui-avatar-stack",
	glyphTile: "tmt-ui-glyph-tile",
	notifications: "tmt-ui-notifications",
	notification: "tmt-ui-notification",
	notificationStatus: "tmt-ui-notification-status",
	notificationHeading: "tmt-ui-notification-heading",
	notificationTag: "tmt-ui-notification-tag",
	notificationLine: "tmt-ui-notification-line",
	notificationQuote: "tmt-ui-notification-quote",
	notificationWaiting: "tmt-ui-notification-waiting",
	drawer: "tmt-ui-drawer",
	drawerHeader: "tmt-ui-drawer-header",
	drawerBody: "tmt-ui-drawer-body",
	dialog: "tmt-ui-dialog",
	dialogHeader: "tmt-ui-dialog-header",
	dialogBody: "tmt-ui-dialog-body",
	dialogActions: "tmt-ui-dialog-actions",
	menu: "tmt-ui-menu",
	menuSurface: "tmt-ui-menu-surface",
	menuItem: "tmt-ui-menu-item",
	command: "tmt-ui-command",
	commandText: "tmt-ui-command-text",
	commandCopy: "tmt-ui-command-copy",
	commandFeedback: "tmt-ui-command-feedback",
	code: "tmt-ui-code",
	header: "tmt-ui-header",
	brand: "tmt-ui-brand",
	mark: "tmt-ui-mark",
	wordmark: "tmt-ui-wordmark",
	heading: "tmt-ui-heading",
	headingSuffix: "tmt-ui-heading-suffix",
	title: "tmt-ui-title",
	caption: "tmt-ui-caption",
	status: "tmt-ui-status",
	actions: "tmt-ui-actions",
	icon: "tmt-ui-icon",
	notice: "tmt-ui-notice",
	noticeMark: "tmt-ui-notice-mark",
	noticeEyebrow: "tmt-ui-notice-eyebrow",
	noticeHeading: "tmt-ui-notice-heading",
	noticeBody: "tmt-ui-notice-body",
	noticeActions: "tmt-ui-notice-actions",
	field: "tmt-ui-field",
	fieldLabel: "tmt-ui-field-label",
	fieldControl: "tmt-ui-field-control",
	searchField: "tmt-ui-search-field",
	fieldDescription: "tmt-ui-field-description",
	fieldError: "tmt-ui-field-error",
	action: "tmt-ui-action",
	actionLabel: "tmt-ui-action-label",
	actionMark: "tmt-ui-action-mark",
	busyMark: "tmt-ui-busy-mark",
	busyDot: "tmt-ui-busy-dot",
	checkbox: "tmt-ui-checkbox",
	checkboxLabel: "tmt-ui-checkbox-label",
	iconAction: "tmt-ui-icon-action",
	iconActionControl: "tmt-ui-icon-action-control",
	iconActionIcon: "tmt-ui-icon-action-icon",
	iconActionTooltip: "tmt-ui-icon-action-tooltip",
	iconActionTooltipLabel: "tmt-ui-icon-action-tooltip-label",
	toggle: "tmt-ui-toggle",
	toggleIndicator: "tmt-ui-toggle-indicator",
	list: "tmt-ui-list",
	listRow: "tmt-ui-list-row",
	listLeading: "tmt-ui-list-leading",
	listTitle: "tmt-ui-list-title",
	listMeta: "tmt-ui-list-meta",
	listLabel: "tmt-ui-list-label",
	listDescription: "tmt-ui-list-description",
	listUpdated: "tmt-ui-list-updated",
	listState: "tmt-ui-list-state",
	listActions: "tmt-ui-list-actions",
	tabs: "tmt-ui-tabs",
	tabsHeader: "tmt-ui-tabs-header",
	tabList: "tmt-ui-tab-list",
	tab: "tmt-ui-tab",
	tabMark: "tmt-ui-tab-mark",
	tabLabel: "tmt-ui-tab-label",
	tabCount: "tmt-ui-tab-count",
	tabsStatus: "tmt-ui-tabs-status",
	tabPanel: "tmt-ui-tab-panel",
	section: "tmt-ui-section",
	sectionHeading: "tmt-ui-section-heading",
	table: "tmt-ui-table",
	disclosure: "tmt-ui-disclosure",
	visuallyHidden: "tmt-ui-visually-hidden"
}), Id = /* @__PURE__ */ new WeakMap();
function Ld(e, t) {
	return Id.get(e)?.(), Id.set(e, t), () => {
		Id.get(e) === t && Id.delete(e);
	};
}
function Rd(e, t, n, r, i, a) {
	let o = Math.max(0, r.width - i * 2), s = Math.min(t, o), c = r.left + i, l = Math.max(r.top, e.bottom), u = Math.max(0, r.top + r.height - i - l), d = a === "above" ? i : 0, f = Math.max(0, e.top - r.top - i - d), p = a === "above" || n > u && f > u, m = p ? f : u, h = p ? e.top - d - Math.min(n, m) : l, g = a === "above" ? Math.max(r.top + i, h) : h;
	return {
		left: Math.max(c, Math.min((e.left + e.right - s) / 2, r.left + r.width - i - s)),
		top: g,
		maxWidth: o,
		maxHeight: m
	};
}
function zd(e, t, n) {
	let r = e.ownerDocument.defaultView;
	if (!r) return () => {};
	let i = r.visualViewport, a = e.closest("[data-tmt-ds-scope]"), o = () => {
		let o = e.getBoundingClientRect();
		if (!e.isConnected || !o.width || !o.height) {
			t.matches(":popover-open") && t.hidePopover(), a && (t.hidden = !0);
			return;
		}
		let s = Number.parseFloat(r.getComputedStyle(t).paddingTop) || 0, c = a?.getBoundingClientRect(), l = c ?? {
			left: i?.offsetLeft ?? 0,
			top: i?.offsetTop ?? 0,
			width: i?.width ?? r.innerWidth,
			height: i?.height ?? r.innerHeight
		};
		t.style.maxWidth = `${Math.max(0, l.width - s * 2)}px`;
		let u = t.getBoundingClientRect(), d = Rd(o, u.width, Math.max(u.height, t.scrollHeight), l, s, n), f = a ? t.offsetParent?.getBoundingClientRect() ?? c : void 0;
		t.style.left = `${d.left - (f?.left ?? 0)}px`, t.style.top = `${d.top - (f?.top ?? 0)}px`, t.style.maxHeight = `${d.maxHeight}px`;
	};
	o();
	let s = new ResizeObserver(o);
	return s.observe(e), s.observe(t), a && s.observe(a), r.addEventListener("resize", o), r.addEventListener("scroll", o, !0), i?.addEventListener("resize", o), i?.addEventListener("scroll", o), () => {
		s.disconnect(), r.removeEventListener("resize", o), r.removeEventListener("scroll", o, !0), i?.removeEventListener("resize", o), i?.removeEventListener("scroll", o);
	};
}
var Bd = /* @__PURE__ */ new WeakSet();
function Vd(e) {
	Bd.add(e);
	let t = () => {
		Bd.delete(e), e.removeEventListener("keydown", n, !0);
	}, n = (e) => {
		e.key !== "Escape" && t();
	};
	e.addEventListener("keydown", n, !0), e.defaultView?.requestAnimationFrame(t);
}
function Hd(e, t, n, r) {
	let i = t.ownerDocument, a = i.defaultView, o = e.closest("[data-tmt-ds-scope]");
	o && (n.removeAttribute("popover"), n.hidden = !0);
	let s = () => o ? !n.hidden : n.matches(":popover-open"), c = !1, l = !1, u = !1, d = !1, f = t.getAttribute("aria-expanded") === "true", p = !1, m, h, g, _ = () => {
		g?.(), g = void 0, h?.(), h = void 0, i.removeEventListener("keydown", y, !0), o ? (n.hidden = !0, n.removeAttribute("data-tmt-ds-open")) : n.matches(":popover-open") && n.hidePopover();
	}, v = () => {
		u = !0, _();
	}, y = (e) => {
		e.key !== "Escape" || !s() || o && !o.contains(e.target) || (v(), Vd(i));
	}, b = () => {
		if (!(!d && (c || l) && !u && !f && t.isConnected && t.getClientRects().length > 0)) {
			_();
			return;
		}
		if (s()) return;
		let e = r ? r.anchor() : t;
		e?.isConnected && (h = Ld(o ?? i, v), o ? (n.hidden = !1, n.setAttribute("data-tmt-ds-open", "")) : n.showPopover(), g = zd(e, n, r?.side), i.addEventListener("keydown", y, !0));
	}, x = () => {
		p = !1, i.removeEventListener("keydown", S, !0), m !== void 0 && a.cancelAnimationFrame(m), m = void 0;
	}, S = (e) => {
		e.key !== "Escape" && x();
	}, C = () => {
		let e = t.getAttribute("aria-expanded") === "true";
		f && !e && (x(), p = !0, i.addEventListener("keydown", S, !0), m = a.requestAnimationFrame(x)), f = e, f && (u = !0), b();
	}, w = () => {
		c || (c = !0, u = !1), C();
	}, ee = () => {
		c = !1, C();
	}, te = () => {
		t.matches(":focus-visible") && (l = !0, f = t.getAttribute("aria-expanded") === "true", u = f || p || Bd.has(i), b());
	}, ne = () => {
		l = !1, C();
	};
	return e.addEventListener("pointermove", w), e.addEventListener("pointerleave", ee), t.addEventListener("focus", te), t.addEventListener("blur", ne), {
		refresh: C,
		dismiss: v,
		dispose() {
			d || (d = !0, _(), x(), e.removeEventListener("pointermove", w), e.removeEventListener("pointerleave", ee), t.removeEventListener("focus", te), t.removeEventListener("blur", ne));
		}
	};
}
//#endregion
//#region ../../../../design/browser-ui/src/rail-state.ts
var Ud = "tmt-shell-rail", Wd = /* @__PURE__ */ new Set(), Gd = Kd();
function Kd() {
	try {
		return globalThis.localStorage?.getItem(Ud) === "collapsed";
	} catch {
		return !1;
	}
}
globalThis.addEventListener?.("storage", (e) => {
	if (e.key !== "tmt-shell-rail" && e.key !== null) return;
	let t = Kd();
	if (t !== Gd) {
		Gd = t;
		for (let e of Wd) e();
	}
});
//#endregion
//#region ../../../../design/browser-ui/src/ui/scope.tsx
var qd = o();
(0, y.createContext)(void 0), (0, y.createContext)(void 0), (0, y.createContext)(null), (0, y.createContext)(null), (0, y.createContext)(null), (0, y.createContext)(null);
//#endregion
//#region ../../../../design/browser-ui/src/field.tsx
function Jd({ controlId: e, label: t, description: n, descriptionId: r, error: i, errorId: a, describedByIds: o = [], invalid: s, renderControl: c }) {
	let l = n != null, u = i != null, d = `${e}-label`, f = [l ? r : void 0, u ? a : void 0];
	if (!e.trim() || /\s/.test(e) || l && !r || u && !a) throw Error("Field content requires explicit nonempty IDs");
	let p = [
		e,
		d,
		...f.filter((e) => e !== void 0)
	];
	if (p.some((e) => !e.trim() || /\s/.test(e)) || new Set(p).size !== p.length) throw Error("Field IDs must be distinct single IDs");
	let m = [.../* @__PURE__ */ new Set([...o.flatMap((e) => e.split(/\s+/).filter(Boolean)), ...p.slice(2)])].join(" ") || void 0;
	return /* @__PURE__ */ (0, $.jsxs)("div", {
		className: Fd.field,
		children: [
			/* @__PURE__ */ (0, $.jsx)("label", {
				className: Fd.fieldLabel,
				id: d,
				htmlFor: e,
				children: t
			}),
			c({
				id: e,
				className: Fd.fieldControl,
				"aria-labelledby": d,
				"aria-describedby": m,
				"aria-invalid": s
			}),
			l && /* @__PURE__ */ (0, $.jsx)("div", {
				className: Fd.fieldDescription,
				id: r,
				children: n
			}),
			u && /* @__PURE__ */ (0, $.jsx)("div", {
				className: Fd.fieldError,
				id: a,
				children: i
			})
		]
	});
}
function Yd(e) {
	let t = !1, n = !1, r = 0, i, a = () => {
		i !== void 0 && clearTimeout(i), i = void 0;
	}, o = (t) => {
		n = t, t && (r = Date.now()), e(t);
	};
	return {
		shown: () => n,
		set(e) {
			if (e === t) return;
			if (t = e, a(), t) {
				n || (i = setTimeout(() => o(!0), 400));
				return;
			}
			if (!n) return;
			let s = r + 400 - Date.now();
			s <= 0 ? o(!1) : i = setTimeout(() => o(!1), s);
		},
		dispose() {
			a(), t = !1;
		}
	};
}
//#endregion
//#region ../../../../design/browser-ui/src/busy-mark.ts
function Xd(e) {
	let [t, n] = (0, y.useState)(!1), [r] = (0, y.useState)(() => Yd(n));
	return (0, y.useEffect)(() => {
		r.set(e);
	}, [r, e]), (0, y.useEffect)(() => () => r.dispose(), [r]), t;
}
//#endregion
//#region ../../../../design/browser-ui/src/icon-action.tsx
function Zd({ type: e, label: t, tooltipLabel: n, tooltipPlacement: r, ariaKeyShortcuts: i, variant: a, icon: o, pressed: s, expanded: c, controls: l, disabled: u = !1, disabledReason: d, disabledReasonId: f, busy: p = !1, busyMark: m, onActivate: h, buttonRef: g, hasPopup: _, onKeyDown: v }) {
	let b = (0, y.useRef)(null), x = (0, y.useRef)(null), S = (0, y.useRef)(null), C = (0, y.useRef)(null), w = Xd(p && !u);
	if ((0, y.useImperativeHandle)(g, () => b.current, []), (0, y.useLayoutEffect)(() => (C.current = Hd(S.current, b.current, x.current, r), () => {
		C.current?.dispose(), C.current = null;
	}), [r]), (0, y.useLayoutEffect)(() => {
		C.current?.refresh();
	}, [c]), !t.trim()) throw Error("Icon action requires a nonempty label");
	if (d !== void 0 && !f) throw Error("Disabled reason requires a stable ID");
	return /* @__PURE__ */ (0, $.jsxs)($.Fragment, { children: [/* @__PURE__ */ (0, $.jsxs)("span", {
		className: Fd.iconAction,
		ref: S,
		children: [/* @__PURE__ */ (0, $.jsxs)("button", {
			ref: b,
			className: `${Fd.action} ${Fd.iconActionControl}`,
			type: e,
			"data-variant": a,
			disabled: u,
			"aria-disabled": p && !u || void 0,
			"aria-label": t,
			"aria-keyshortcuts": i,
			"aria-haspopup": _,
			"aria-pressed": s,
			"aria-expanded": c,
			"aria-controls": l,
			"aria-busy": p || void 0,
			"aria-describedby": d === void 0 ? void 0 : f,
			onKeyDown: v,
			onClick: (e) => {
				p ? e.preventDefault() : u || (C.current?.dismiss(), h(e));
			},
			children: [/* @__PURE__ */ (0, $.jsx)("span", {
				className: Fd.iconActionIcon,
				"aria-hidden": "true",
				children: o
			}), m !== void 0 && /* @__PURE__ */ (0, $.jsx)("span", {
				className: Fd.actionMark,
				"aria-hidden": "true",
				"data-busy": w,
				children: m
			})]
		}), /* @__PURE__ */ (0, $.jsx)("span", {
			ref: x,
			className: Fd.iconActionTooltip,
			popover: "manual",
			"aria-hidden": "true",
			children: /* @__PURE__ */ (0, $.jsx)("span", {
				className: Fd.iconActionTooltipLabel,
				children: n ?? t
			})
		})]
	}), d !== void 0 && /* @__PURE__ */ (0, $.jsx)("span", {
		className: Fd.fieldDescription,
		id: f,
		children: d
	})] });
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+text@0.52.0_typescript@5.9.3/node_modules/@lexical/text/dist/LexicalText.prod.js
function Qd() {
	return Mc().getTextContent();
}
function $d(e, t = !0) {
	if (e) return !1;
	let n = Qd();
	return t && (n = n.trim()), n === "";
}
function ef(e) {
	if (!$d(e, !1)) return !1;
	let t = Mc().getChildren(), n = t.length;
	if (n > 1) return !1;
	for (let e = 0; e < n; e++) {
		let n = t[e];
		if (V(n)) return !1;
		if (B(n)) {
			if (!Js(n) || n.__indent !== 0) return !1;
			let e = n.getChildren(), t = e.length;
			for (let n = 0; n < t; n++) {
				let t = e[n];
				if (!N(t)) return !1;
			}
		}
	}
	return !0;
}
function tf(e) {
	return () => ef(e);
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+react@0.52.0_react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@5.9.3_yjs@13.6.32/node_modules/@lexical/react/dist/LexicalContentEditable.prod.js
var nf = D ? y.useLayoutEffect : y.useEffect;
function rf({ editor: e, ariaActiveDescendant: t, ariaAutoComplete: n, ariaControls: r, ariaDescribedBy: i, ariaErrorMessage: a, ariaExpanded: o, ariaInvalid: s, ariaLabel: c, ariaLabelledBy: l, ariaMultiline: u, ariaOwns: d, ariaRequired: f, autoCapitalize: p, className: m, id: h, role: g = "textbox", spellCheck: _ = !0, style: v, tabIndex: b, "data-testid": x, ...S }, C) {
	let [w, ee] = (0, y.useState)(e.isEditable()), te = (0, y.useCallback)((t) => {
		t && t.ownerDocument && t.ownerDocument.defaultView ? e.setRootElement(t) : e.setRootElement(null);
	}, [e]), ne = (0, y.useMemo)(() => function(...e) {
		return (t) => {
			for (let n of e) typeof n == "function" ? n(t) : n != null && (n.current = t);
		};
	}(C, te), [te, C]);
	return nf(() => (ee(e.isEditable()), e.registerEditableListener((e) => {
		ee(e);
	})), [e]), /*#__PURE__*/ (0, $.jsx)("div", {
		"aria-activedescendant": w ? t : void 0,
		"aria-autocomplete": w ? n : "none",
		"aria-controls": w ? r : void 0,
		"aria-describedby": i,
		...a == null ? {} : { "aria-errormessage": a },
		"aria-expanded": w && g === "combobox" ? !!o : void 0,
		...s == null ? {} : { "aria-invalid": s },
		"aria-label": c,
		"aria-labelledby": l,
		"aria-multiline": u,
		"aria-owns": w ? d : void 0,
		"aria-readonly": !w || void 0,
		"aria-required": f,
		autoCapitalize: p,
		className: m,
		contentEditable: w,
		"data-testid": x,
		id: h,
		ref: ne,
		role: g,
		spellCheck: _,
		style: v,
		tabIndex: b ?? (w ? void 0 : -1),
		...S
	});
}
var af = /* @__PURE__ */ (0, y.forwardRef)(rf);
function of(e) {
	return e.read("latest", tf(e.isComposing()));
}
var sf = /* @__PURE__ */ (0, y.forwardRef)(cf);
function cf(e, t) {
	let { placeholder: n, ...r } = e, [i] = se();
	return (0, $.jsxs)($.Fragment, { children: [/*#__PURE__*/ (0, $.jsx)(af, {
		editor: i,
		...r,
		ref: t
	}), n != null && /*#__PURE__*/ (0, $.jsx)(lf, {
		editor: i,
		content: n
	})] });
}
function lf({ content: e, editor: t }) {
	let n = function(e) {
		let [t, n] = (0, y.useState)(() => of(e));
		return nf(() => {
			function t() {
				let t = of(e);
				n(t);
			}
			return t(), Nd(e.registerUpdateListener(() => {
				t();
			}), e.registerEditableListener(() => {
				t();
			}));
		}, [e]), t;
	}(t), [r, i] = (0, y.useState)(t.isEditable());
	if (nf(() => (i(t.isEditable()), t.registerEditableListener((e) => {
		i(e);
	})), [t]), !n) return null;
	let a = null;
	return typeof e == "function" ? a = e(r) : e !== null && (a = e), a === null ? null : /*#__PURE__*/ (0, $.jsx)("div", {
		"aria-hidden": !0,
		children: a
	});
}
//#endregion
//#region ../../../../design/browser-ui/src/rich-input/chip-node.tsx
var uf = (0, y.createContext)((e, t) => `Remove ${t}`), df = (0, y.createContext)(void 0), ff = class e extends ds {
	__kind;
	__text;
	__data;
	static getType() {
		return "tmt-rich-input-chip";
	}
	static clone(t) {
		return new e(t.__kind, t.__text, t.__data, t.__key);
	}
	constructor(e, t, n, r) {
		super(r), this.__kind = e, this.__text = t, this.__data = n;
	}
	static importJSON(t) {
		return new e(t.kind, t.text, t.data).updateFromJSON(t);
	}
	exportJSON() {
		return {
			...super.exportJSON(),
			type: "tmt-rich-input-chip",
			kind: this.__kind,
			text: this.__text,
			...this.__data ? { data: this.__data } : {}
		};
	}
	createDOM() {
		let e = document.createElement("span");
		return e.className = "tmt-rich-input-chip-host", e;
	}
	updateDOM() {
		return !1;
	}
	exportDOM() {
		return { element: document.createTextNode(this.getTextContent()) };
	}
	isInline() {
		return !0;
	}
	isKeyboardSelectable() {
		return !1;
	}
	getTextContent() {
		return this.__text;
	}
	getKind() {
		return this.__kind;
	}
	getData() {
		return this.__data;
	}
	decorate() {
		return (0, y.createElement)(pf, {
			nodeKey: this.getKey(),
			kind: this.__kind,
			text: this.__text,
			data: this.__data
		});
	}
};
function pf({ nodeKey: e, kind: t, text: n, data: r }) {
	let [i] = se(), a = (0, y.useContext)(uf), o = (0, y.useContext)(df), s = () => {
		i.isEditable() && (i.update(() => {
			let t = H(e);
			t && (t.selectPrevious(), t.remove());
		}, {
			tag: Ki,
			discrete: !0
		}), i.focus());
	};
	return o ? o({
		kind: t,
		text: n,
		data: r,
		remove: s
	}) : /* @__PURE__ */ (0, $.jsxs)("span", {
		className: "tmt-rich-input-chip",
		"data-kind": t,
		contentEditable: !1,
		children: [/* @__PURE__ */ (0, $.jsx)("span", {
			className: "tmt-rich-input-chip-text",
			children: n
		}), /* @__PURE__ */ (0, $.jsx)("button", {
			type: "button",
			className: "tmt-rich-input-chip-remove",
			"aria-label": a(t, n),
			onMouseDown: (e) => e.preventDefault(),
			onKeyDownCapture: (e) => {
				!e.nativeEvent.isTrusted || e.key !== "Enter" && e.key !== " " || (e.preventDefault(), e.stopPropagation(), s());
			},
			onClick: (e) => {
				e.nativeEvent.isTrusted && s();
			},
			children: /* @__PURE__ */ (0, $.jsx)(ie, { "aria-hidden": "true" })
		})]
	});
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+extension@0.52.0_typescript@5.9.3/node_modules/@lexical/extension/dist/LexicalExtensionConfig.prod.js
function mf(e) {
	return (typeof e.nodes == "function" ? e.nodes() : e.nodes) || [];
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+extension@0.52.0_typescript@5.9.3/node_modules/@lexical/extension/dist/LexicalExtensionInitialStateExtension.prod.js
var hf = { tag: qi };
function gf() {
	let e = Mc();
	e.isEmpty() && e.append(qs());
}
var _f = {
	config: {
		setOptions: hf,
		updateOptions: hf
	},
	init: ({ $initialEditorState: e = gf }) => ({
		$initialEditorState: e,
		initialized: !1
	}),
	afterRegistration(e, { updateOptions: t, setOptions: n }, r) {
		let i = r.getInitResult();
		if (!i.initialized) {
			i.initialized = !0;
			let { $initialEditorState: r } = i;
			if (_s(r)) e.setEditorState(r, n);
			else if (typeof r == "function") e.update(() => {
				r(e);
			}, t);
			else if (r && (typeof r == "string" || typeof r == "object")) {
				let t = e.parseEditorState(r);
				e.setEditorState(t, n);
			}
		}
		return () => {};
	},
	name: "@lexical/extension/InitialState",
	nodes: [
		fs,
		va,
		bs,
		Aa,
		Gs
	]
};
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+extension@0.52.0_typescript@5.9.3/node_modules/@lexical/extension/dist/LexicalExtensionLexicalBuilder.prod.js
function vf(e, ...t) {
	throw function(e, ...t) {
		let n = new URL("https://lexical.dev/docs/error"), r = new URLSearchParams();
		r.append("code", e);
		for (let e of t) r.append("v", e);
		return n.search = r.toString(), /* @__PURE__ */ Error(`Minified Lexical error #${e}; visit ${n.toString()} for the full message or use the non-minified dev environment for full errors and additional helpful warnings.`);
	}(e, ...t);
}
function yf() {
	let e;
	try {
		e = "0.52.0+prod.esm";
	} catch {}
	return e ?? "\"<unknown>+source\"";
}
var bf = /* @__PURE__ */ yf(), xf = /* @__PURE__ */ new Set([
	"__proto__",
	"constructor",
	"prototype"
]);
function Sf(e, t) {
	if (e && t && !Array.isArray(t) && typeof e == "object" && typeof t == "object") {
		let n = e, r = t;
		for (let e in r) !xf.has(e) && Object.prototype.hasOwnProperty.call(r, e) && (n[e] = Sf(n[e], r[e]));
		return e;
	}
	return t;
}
function Cf(e) {
	return e.id === 0;
}
function wf(e) {
	return e.id === 2;
}
var Tf = /* @__PURE__ */ new Set(), Ef = class {
	builder;
	configs;
	_dependency;
	_peerNameSet;
	extension;
	state;
	_signal;
	constructor(e, t) {
		this.builder = e, this.extension = t, this.configs = /* @__PURE__ */ new Set(), this.state = { id: 0 };
	}
	mergeConfigs() {
		let e = this.extension.config || {}, t = this.extension.mergeConfig ? this.extension.mergeConfig.bind(this.extension) : jd;
		for (let n of this.configs) e = t(e, n);
		return e;
	}
	init(e) {
		let t = this.state;
		wf(t) || vf(306, String(t.id));
		let n = {
			getDependency: this.getInitDependency.bind(this),
			getDirectDependentNames: this.getDirectDependentNames.bind(this),
			getPeer: this.getInitPeer.bind(this),
			getPeerNameSet: this.getPeerNameSet.bind(this)
		}, r = {
			...n,
			getDependency: this.getDependency.bind(this),
			getInitResult: this.getInitResult.bind(this),
			getPeer: this.getPeer.bind(this)
		}, i = function(e, t, n) {
			return Object.assign(e, {
				config: t,
				id: 3,
				registerState: n
			});
		}(t, this.mergeConfigs(), n), a;
		this.state = i, this.extension.init && (a = this.extension.init(e, i.config, n)), this.state = function(e, t, n) {
			return Object.assign(e, {
				id: 4,
				initResult: t,
				registerState: n
			});
		}(i, a, r);
	}
	build(e) {
		let t = this.state, n;
		t.id !== 4 && vf(307, String(t.id), "5"), this.extension.build && (n = this.extension.build(e, t.config, t.registerState));
		let r = {
			...t.registerState,
			getOutput: () => n,
			getSignal: this.getSignal.bind(this)
		};
		this.state = function(e, t, n) {
			return Object.assign(e, {
				id: 5,
				output: t,
				registerState: n
			});
		}(t, n, r);
	}
	register(e, t) {
		this._signal = t;
		let n = this.state;
		n.id !== 5 && vf(308, String(n.id), "5");
		let r = this.extension.register && this.extension.register(e, n.config, n.registerState);
		return this.state = function(e) {
			return Object.assign(e, { id: 6 });
		}(n), () => {
			let e = this.state;
			e.id !== 7 && vf(309, String(n.id), "7"), this.state = function(e) {
				return Object.assign(e, { id: 5 });
			}(e), r && r();
		};
	}
	afterRegistration(e) {
		let t = this.state, n;
		return t.id !== 6 && vf(310, String(t.id), "6"), this.extension.afterRegistration && (n = this.extension.afterRegistration(e, t.config, t.registerState)), this.state = function(e) {
			return Object.assign(e, { id: 7 });
		}(t), n;
	}
	getSignal() {
		return this._signal === void 0 && vf(311), this._signal;
	}
	getInitResult() {
		this.extension.init === void 0 && vf(312, this.extension.name);
		let e = this.state;
		return function(e) {
			return e.id >= 4;
		}(e) || vf(313, String(e.id), "4"), e.initResult;
	}
	getInitPeer(e) {
		let t = this.builder.extensionNameMap.get(e);
		return t ? t.getExtensionInitDependency() : void 0;
	}
	getExtensionInitDependency() {
		let e = this.state;
		return function(e) {
			return e.id >= 3;
		}(e) || vf(314, String(e.id), "3"), { config: e.config };
	}
	getPeer(e) {
		let t = this.builder.extensionNameMap.get(e);
		return t ? t.getExtensionDependency() : void 0;
	}
	getInitDependency(e) {
		let t = this.builder.getExtensionRep(e);
		return t === void 0 && vf(315, this.extension.name, e.name), t.getExtensionInitDependency();
	}
	getDependency(e) {
		let t = this.builder.getExtensionRep(e);
		return t === void 0 && vf(315, this.extension.name, e.name), t.getExtensionDependency();
	}
	getState() {
		let e = this.state;
		return function(e) {
			return e.id >= 7;
		}(e) || vf(316, String(e.id), "7"), e;
	}
	getDirectDependentNames() {
		return this.builder.incomingEdges.get(this.extension.name) || Tf;
	}
	getPeerNameSet() {
		let e = this._peerNameSet;
		return e || (e = new Set((this.extension.peerDependencies || []).map(([e]) => e)), this._peerNameSet = e), e;
	}
	getExtensionDependency() {
		if (!this._dependency) {
			let e = this.state;
			(function(e) {
				return e.id >= 5;
			})(e) || vf(317, this.extension.name), this._dependency = {
				config: e.config,
				init: e.initResult,
				output: e.output
			};
		}
		return this._dependency;
	}
}, Df = Symbol.for("@lexical/extension/LexicalBuilder");
function Of() {}
function kf(e) {
	throw e;
}
function Af(e) {
	return Array.isArray(e) ? e : [e];
}
var jf = bf, Mf = class e {
	roots;
	extensionNameMap;
	outgoingConfigEdges;
	incomingEdges;
	conflicts;
	_sortedExtensionReps;
	PACKAGE_VERSION;
	constructor(e) {
		this.outgoingConfigEdges = /* @__PURE__ */ new Map(), this.incomingEdges = /* @__PURE__ */ new Map(), this.extensionNameMap = /* @__PURE__ */ new Map(), this.conflicts = /* @__PURE__ */ new Map(), this.PACKAGE_VERSION = jf, this.roots = e;
		for (let t of e) this.addExtension(t);
	}
	static fromExtensions(t) {
		let n = [Af(_f)];
		for (let e of t) n.push(Af(e));
		return new e(n);
	}
	static maybeFromEditor(t) {
		let n = t[Df];
		return n && (n.PACKAGE_VERSION !== jf && vf(292, n.PACKAGE_VERSION, jf), n instanceof e || vf(293)), n;
	}
	static fromEditor(t) {
		let n = e.maybeFromEditor(t);
		return n === void 0 && vf(294), n;
	}
	constructEditor() {
		let { $initialEditorState: e, onError: t, onWarn: n, ...r } = this.buildCreateEditorArgs(), i = Object.assign($s({
			...r,
			...t ? { onError: (e) => {
				t(e, i);
			} } : {},
			...n ? { onWarn: (e) => {
				n(e, i);
			} } : {}
		}), { [Df]: this });
		for (let e of this.sortedExtensionReps()) e.build(i);
		return i;
	}
	buildEditor() {
		let e = Of;
		function t() {
			try {
				e();
			} finally {
				e = Of;
			}
		}
		let n = Object.assign(this.constructEditor(), {
			dispose: t,
			[Symbol.dispose]: t
		});
		return e = Nd(this.registerEditor(n), () => n.setRootElement(null)), n;
	}
	hasExtensionByName(e) {
		return this.extensionNameMap.has(e);
	}
	getExtensionRep(e) {
		let t = this.extensionNameMap.get(e.name);
		if (t) return t.extension !== e && vf(295, e.name), t;
	}
	addEdge(e, t, n) {
		let r = this.outgoingConfigEdges.get(e);
		if (r) {
			let e = r.get(t);
			e ? e.push(...n) : r.set(t, n);
		} else this.outgoingConfigEdges.set(e, /* @__PURE__ */ new Map([[t, n]]));
		let i = this.incomingEdges.get(t);
		i ? i.add(e) : this.incomingEdges.set(t, /* @__PURE__ */ new Set([e]));
	}
	addExtension(e) {
		this._sortedExtensionReps !== void 0 && vf(296);
		let [t] = Af(e);
		typeof t.name != "string" && vf(297, typeof t.name);
		let n = this.extensionNameMap.get(t.name);
		if (n !== void 0 && n.extension !== t && vf(298, t.name), !n) {
			n = new Ef(this, t), this.extensionNameMap.set(t.name, n);
			let e = this.conflicts.get(t.name);
			typeof e == "string" && vf(299, t.name, e);
			for (let e of t.conflictsWith || []) this.extensionNameMap.has(e) && vf(299, t.name, e), this.conflicts.set(e, t.name);
			for (let e of t.dependencies || []) {
				let n = Af(e);
				this.addEdge(t.name, n[0].name, n.slice(1)), this.addExtension(n);
			}
			for (let [e, n] of t.peerDependencies || []) this.addEdge(t.name, e, n ? [n] : []);
		}
	}
	sortedExtensionReps() {
		if (this._sortedExtensionReps) return this._sortedExtensionReps;
		let e = [], t = (n, r) => {
			let i = n.state;
			if (wf(i)) return;
			let a = n.extension.name;
			var o;
			Cf(i) || vf(300, a, r || "[unknown]"), Cf(o = i) || vf(304, String(o.id), "0"), i = Object.assign(o, { id: 1 }), n.state = i;
			let s = this.outgoingConfigEdges.get(a);
			if (s) for (let e of s.keys()) {
				let n = this.extensionNameMap.get(e);
				n && t(n, a);
			}
			i = function(e) {
				return function(e) {
					return e.id === 1;
				}(e) || vf(305, String(e.id), "1"), Object.assign(e, { id: 2 });
			}(i), n.state = i, e.push(n);
		};
		for (let e of this.extensionNameMap.values()) Cf(e.state) && t(e);
		for (let t of e) for (let [e, n] of this.outgoingConfigEdges.get(t.extension.name) || []) if (n.length > 0) {
			let t = this.extensionNameMap.get(e);
			if (t) for (let e of n) t.configs.add(e);
		}
		for (let [e, ...t] of this.roots) if (t.length > 0) {
			let n = this.extensionNameMap.get(e.name);
			n === void 0 && vf(301, e.name);
			for (let e of t) n.configs.add(e);
		}
		return this._sortedExtensionReps = e, this._sortedExtensionReps;
	}
	registerEditor(e) {
		let t = this.sortedExtensionReps(), n = new AbortController(), r = [() => n.abort()], i = n.signal;
		for (let n of t) {
			let t = n.register(e, i);
			t && r.push(t);
		}
		for (let n of t) {
			let t = n.afterRegistration(e);
			t && r.push(t);
		}
		return Nd(...r);
	}
	buildCreateEditorArgs() {
		let e = {}, t = /* @__PURE__ */ new Set(), n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map(), i = {}, a = {}, o = this.sortedExtensionReps();
		for (let s of o) {
			let { extension: o } = s;
			if (o.onError !== void 0 && (e.onError = o.onError), o.onWarn !== void 0 && (e.onWarn = o.onWarn), o.disableEvents !== void 0 && (e.disableEvents = o.disableEvents), o.parentEditor !== void 0 && (e.parentEditor = o.parentEditor), o.editable !== void 0 && (e.editable = o.editable), o.namespace !== void 0 && (e.namespace = o.namespace), o.$initialEditorState !== void 0 && (e.$initialEditorState = o.$initialEditorState), o.nodes) for (let e of mf(o)) {
				if (typeof e != "function") {
					let t = n.get(e.replace);
					t && vf(302, o.name, e.replace.name, t.extension.name), n.set(e.replace, s);
				}
				t.add(e);
			}
			if (o.html) {
				if (o.html.export) for (let [e, t] of o.html.export.entries()) r.set(e, t);
				o.html.import && Object.assign(i, o.html.import);
			}
			o.theme && Sf(a, o.theme);
		}
		Object.keys(a).length > 0 && (e.theme = a), t.size && (e.nodes = Array.from(t));
		let s = Object.keys(i).length > 0, c = r.size > 0;
		(s || c) && (e.html = {}, s && (e.html.import = i), c && (e.html.export = r));
		for (let t of o) t.init(e);
		return e.onError ||= kf, e;
	}
};
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+extension@0.52.0_typescript@5.9.3/node_modules/@lexical/extension/dist/LexicalExtensionGetExtensionDependencyFromEditor.prod.js
function Nf(e, t) {
	let n = Mf.fromEditor(e).getExtensionRep(t);
	return n === void 0 && function(e, ...t) {
		throw function(e, ...t) {
			let n = new URL("https://lexical.dev/docs/error"), r = new URLSearchParams();
			r.append("code", e);
			for (let e of t) r.append("v", e);
			return n.search = r.toString(), /* @__PURE__ */ Error(`Minified Lexical error #${e}; visit ${n.toString()} for the full message or use the non-minified dev environment for full errors and additional helpful warnings.`);
		}(e, ...t);
	}(303, t.name), n.getExtensionDependency();
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+react@0.52.0_react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@5.9.3_yjs@13.6.32/node_modules/@lexical/react/dist/LexicalErrorBoundary.prod.js
var Pf = class extends y.Component {
	state = { hasError: !1 };
	static getDerivedStateFromError() {
		return { hasError: !0 };
	}
	componentDidCatch(e, t) {
		this.props.onError(e instanceof Error ? e : Error(String(e), { cause: e }), t);
	}
	render() {
		return this.state.hasError ? this.props.fallback : this.props.children;
	}
};
function Ff({ children: e, fallback: t, onError: n }) {
	return (0, $.jsx)(Pf, {
		fallback: t === void 0 ? /*#__PURE__*/ (0, $.jsx)("div", {
			style: {
				border: "1px solid #f00",
				color: "#f00",
				padding: "8px"
			},
			children: "An error was thrown."
		}) : t,
		onError: n,
		children: e
	});
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+react@0.52.0_react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@5.9.3_yjs@13.6.32/node_modules/@lexical/react/dist/LexicalReactProviderExtension.prod.js
var If = { name: "@lexical/react/ReactProvider" };
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+react@0.52.0_react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@5.9.3_yjs@13.6.32/node_modules/@lexical/react/dist/LexicalReactExtension.prod.js
function Lf({ contentEditable: e, children: t }) {
	return (0, $.jsxs)($.Fragment, { children: [e, t] });
}
var Rf = {
	build(e, t, n) {
		n.getPeer(If.name) || function(e, ...t) {
			throw function(e, ...t) {
				let n = new URL("https://lexical.dev/docs/error"), r = new URLSearchParams();
				r.append("code", e);
				for (let e of t) r.append("v", e);
				return n.search = r.toString(), /* @__PURE__ */ Error(`Minified Lexical error #${e}; visit ${n.toString()} for the full message or use the non-minified dev environment for full errors and additional helpful warnings.`);
			}(e, ...t);
		}(321, [...n.getDirectDependentNames()].join(" "));
		let r = [e, { getTheme: () => e._config.theme }];
		return {
			Component: function(e, t) {
				let [n] = t, r = e.decorators.map((e) => typeof e == "function" ? /*#__PURE__*/ (0, $.jsx)(e, { context: t }) : e);
				return function(i) {
					let { EditorChildrenComponent: a = e.EditorChildrenComponent, ErrorBoundary: o = e.ErrorBoundary, contentEditable: s = e.contentEditable, children: c } = i, l = function(e, t) {
						let [n, r] = (0, y.useMemo)(() => [(t) => e.registerDecoratorListener(t), () => e.getDecorators()], [e]), i = (0, y.useSyncExternalStore)(n, r, r), a = function(e) {
							let [t, n] = (0, y.useMemo)(() => [e.registerRootListener.bind(e), e.getRootElement.bind(e)], [e]);
							return (0, y.useSyncExternalStore)(t, n, n);
						}(e);
						return (0, y.useMemo)(() => {
							let n = (t) => e._onError(t), r = [];
							for (let a in i) {
								let o = e.getElementByKey(a);
								if (o !== null) {
									let e = /*#__PURE__*/ (0, $.jsx)(t, {
										onError: n,
										children: /*#__PURE__*/ (0, $.jsx)(y.Suspense, {
											fallback: null,
											children: i[a]
										})
									});
									r.push(/*#__PURE__*/ (0, qd.createPortal)(e, o, a));
								}
							}
							return r;
						}, [
							t,
							i,
							e,
							a
						]);
					}(n, o), u = (0, y.useMemo)(() => r.map((e, t) => /*#__PURE__*/ (0, $.jsx)(o, {
						onError: (e) => {
							n._onError(e);
						},
						children: /*#__PURE__*/ (0, $.jsx)(y.Suspense, {
							fallback: null,
							children: e
						})
					}, t)), [o]);
					return (0, $.jsx)(oe.Provider, {
						value: t,
						children: /*#__PURE__*/ (0, $.jsxs)(a, {
							context: t,
							contentEditable: s,
							children: [
								c,
								u,
								l
							]
						})
					});
				};
			}(t, r),
			context: r
		};
	},
	config: {
		EditorChildrenComponent: Lf,
		ErrorBoundary: Ff,
		contentEditable: /*#__PURE__*/ (0, $.jsx)(sf, {}),
		decorators: []
	},
	mergeConfig(e, t) {
		let n = jd(e, t);
		return t.decorators && (n.decorators = t.decorators.length > 0 ? [...e.decorators, ...t.decorators] : e.decorators), n;
	},
	name: "@lexical/react/React",
	peerDependencies: [["@lexical/react/ReactProvider"]]
};
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+react@0.52.0_react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@5.9.3_yjs@13.6.32/node_modules/@lexical/react/dist/LexicalExtensionComposer.prod.js
function zf({ extension: e, children: t, contentEditable: n }) {
	let r = (0, y.useMemo)(() => Mf.fromExtensions([
		If,
		/* @__PURE__ */ Ad(Rf, n === void 0 ? {} : { contentEditable: n }),
		e
	]).buildEditor(), [n, e]);
	(0, y.useEffect)(() => {
		let e = !1;
		return queueMicrotask(() => {
			e = !0;
		}), () => {
			e && r.dispose();
		};
	}, [r]);
	let { Component: i } = Nf(r, Rf).output;
	return (0, $.jsx)(i, { children: t });
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+extension@0.52.0_typescript@5.9.3/node_modules/@lexical/extension/dist/LexicalExtensionGetPeerDependencyFromEditor.prod.js
function Bf(e, t) {
	let n = Mf.maybeFromEditor(e);
	if (!n) return;
	let r = n.extensionNameMap.get(t);
	return r ? r.getExtensionDependency() : void 0;
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+selection@0.52.0_typescript@5.9.3/node_modules/@lexical/selection/dist/LexicalSelection.prod.js
function Vf(e) {
	let t = J().getElementByKey(e.getKey());
	if (t === null) return null;
	let n = t.ownerDocument.defaultView;
	return n === null ? null : n.getComputedStyle(t);
}
function Hf(e) {
	let t = ps(e) ? e : e.getParent();
	return t && Vf(t);
}
function Uf(e, t, n = "self") {
	let r = e.getStartEndPoints();
	if (t.isSelected(e) && !gc(t) && r !== null) {
		let [i, a] = r, o = e.isBackward(), s = i.getNode(), c = a.getNode(), l = t.is(s), u = t.is(c);
		if (l || u) {
			let [r, i] = Ka(e), a = s.is(c), l = t.is(o ? c : s), u = t.is(o ? s : c), d, f = 0;
			a ? (f = r > i ? i : r, d = r > i ? r : i) : l ? (f = o ? i : r, d = void 0) : u && (f = 0, d = o ? r : i);
			let p = t.__text.slice(f, d);
			p !== t.__text && (n === "clone" && (t = ql(t)), t.__text = p);
		}
	}
	return t;
}
function Wf(e) {
	let t = Gf(e);
	return t !== null && t.writingMode === "vertical-rl";
}
function Gf(e) {
	let t = e.anchor.getNode();
	return B(t) ? Vf(t) : Hf(t);
}
function Kf(e, t) {
	let n = Wf(e) ? !t : t;
	Jf(e) && (n = !n);
	let r = Ds(e.focus, n ? "previous" : "next");
	if (Ls(r)) return !1;
	if (ad(r) && !Ma(r.origin) && r.origin.isUnmergeable()) {
		let e = r.getNodeAtCaret();
		if (N(e) && !Ma(e)) return !0;
	}
	for (let e of Z(r)) {
		if (sd(e)) return !e.origin.isInline();
		if (!B(e.origin)) {
			if (V(e.origin)) return !0;
			break;
		}
	}
	return !1;
}
function qf(e, t, n, r) {
	e.modify(t ? "extend" : "move", n, r);
}
function Jf(e) {
	let t = Gf(e);
	return t !== null && t.direction === "rtl";
}
function Yf(e, t, n) {
	let r = Jf(e), i;
	i = Wf(e) || r ? !n : n, qf(e, t, i, "character");
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+utils@0.52.0_typescript@5.9.3/node_modules/@lexical/utils/dist/LexicalUtils.prod.js
function Xf(e, t) {
	if (e == null) return !1;
	let n = Object.getPrototypeOf(e);
	return n != null && n.constructor != null && n.constructor.name === t.name;
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@preact+signals-core@1.14.4/node_modules/@preact/signals-core/dist/signals-core.module.js
var Zf = Symbol.for("preact-signals");
function Qf() {
	if (ip > 1) ip--;
	else {
		var e, t = !1;
		for ((function() {
			var e = cp;
			for (cp = void 0; e !== void 0;) {
				var t = e.S;
				if (t.v === e.v) for (var n = t.t; n !== void 0; n = n.x) n.i === e.i && (n.i = t.i);
				e = e.o;
			}
		})(); rp !== void 0;) {
			var n = rp;
			for (rp = void 0, ap++; n !== void 0;) {
				var r = n.u;
				if (n.u = void 0, n.f &= -3, !(8 & n.f) && pp(n)) try {
					n.c();
				} catch (n) {
					t ||= (e = n, !0);
				}
				n = r;
			}
		}
		if (ap = 0, ip--, t) throw e;
	}
}
function $f(e) {
	if (ip > 0) return e();
	sp = ++op, ip++;
	try {
		return e();
	} finally {
		Qf();
	}
}
var ep, tp = void 0;
function np(e) {
	var t = tp, n = ep;
	tp = void 0, ep = void 0;
	try {
		return e();
	} finally {
		tp = t, ep = n;
	}
}
var rp = void 0, ip = 0, ap = 0, op = 0, sp = 0, cp = void 0, lp = 0;
function up(e) {
	if (tp !== void 0) {
		var t = e.n;
		if (t === void 0 || t.t !== tp) return t = {
			i: 0,
			S: e,
			p: tp.s,
			n: void 0,
			t: tp,
			e: void 0,
			x: void 0,
			r: t
		}, tp.s !== void 0 && (tp.s.n = t), tp.s = t, e.n = t, 32 & tp.f && e.S(t), t;
		if (t.i === -1) return t.i = 0, t.n !== void 0 && (t.n.p = t.p, t.p !== void 0 && (t.p.n = t.n), t.p = tp.s, t.n = void 0, tp.s.n = t, tp.s = t), t;
	}
}
function dp(e, t) {
	this.v = e, this.i = 0, this.n = void 0, this.t = void 0, this.l = 0, this.W = t?.watched, this.Z = t?.unwatched, this.name = t?.name;
}
dp.prototype.brand = Zf, dp.prototype.h = function() {
	return !0;
}, dp.prototype.S = function(e) {
	var t = this, n = this.t;
	n !== e && e.e === void 0 && (e.x = n, this.t = e, n === void 0 ? np(function() {
		var e;
		(e = t.W) == null || e.call(t);
	}) : n.e = e);
}, dp.prototype.U = function(e) {
	var t = this;
	if (this.t !== void 0) {
		var n = e.e, r = e.x;
		n !== void 0 && (n.x = r, e.e = void 0), r !== void 0 && (r.e = n, e.x = void 0), e === this.t && (this.t = r, r === void 0 && np(function() {
			var e;
			(e = t.Z) == null || e.call(t);
		}));
	}
}, dp.prototype.subscribe = function(e) {
	var t = this;
	return xp(function() {
		var n = t.value;
		np(function() {
			return e(n);
		});
	}, { name: "sub" });
}, dp.prototype.valueOf = function() {
	return this.value;
}, dp.prototype.toString = function() {
	return this.value + "";
}, dp.prototype.toJSON = function() {
	return this.value;
}, dp.prototype.peek = function() {
	var e = this;
	return np(function() {
		return e.value;
	});
}, Object.defineProperty(dp.prototype, "value", {
	get: function() {
		var e = up(this);
		return e !== void 0 && (e.i = this.i), this.v;
	},
	set: function(e) {
		if (e !== this.v) {
			if (ap > 100) throw Error("Cycle detected");
			(function(e) {
				ip !== 0 && ap === 0 && e.l !== sp && (e.l = sp, cp = {
					S: e,
					v: e.v,
					i: e.i,
					o: cp
				});
			})(this), this.v = e, this.i++, lp++, ip++;
			try {
				for (var t = this.t; t !== void 0; t = t.x) t.t.N();
			} finally {
				Qf();
			}
		}
	}
});
function fp(e, t) {
	return new dp(e, t);
}
function pp(e) {
	for (var t = e.s; t !== void 0; t = t.n) if (t.S.i !== t.i || !t.S.h() || t.S.i !== t.i) return !0;
	return !1;
}
function mp(e) {
	for (var t = e.s; t !== void 0; t = t.n) {
		var n = t.S.n;
		if (n !== void 0 && (t.r = n), t.S.n = t, t.i = -1, t.n === void 0) {
			e.s = t;
			break;
		}
	}
}
function hp(e) {
	for (var t = e.s, n = void 0; t !== void 0;) {
		var r = t.p;
		t.i === -1 ? (t.S.U(t), r !== void 0 && (r.n = t.n), t.n !== void 0 && (t.n.p = r)) : n = t, t.S.n = t.r, t.r !== void 0 && (t.r = void 0), t = r;
	}
	e.s = n;
}
function gp(e, t) {
	dp.call(this, void 0, t), this.x = e, this.s = void 0, this.g = lp - 1, this.f = 4;
}
gp.prototype = new dp(), gp.prototype.h = function() {
	if (this.f &= -3, 1 & this.f) return !1;
	if ((36 & this.f) == 32 || (this.f &= -5, this.g === lp)) return !0;
	if (this.g = lp, this.f |= 1, this.i > 0 && !pp(this)) return this.f &= -2, !0;
	var e = tp;
	try {
		mp(this), tp = this;
		var t = this.x();
		(16 & this.f || this.v !== t || this.i === 0) && (this.v = t, this.f &= -17, this.i++);
	} catch (e) {
		this.v = e, this.f |= 16, this.i++;
	}
	return tp = e, hp(this), this.f &= -2, !0;
}, gp.prototype.S = function(e) {
	if (this.t === void 0) {
		this.f |= 36;
		for (var t = this.s; t !== void 0; t = t.n) t.S.S(t);
	}
	dp.prototype.S.call(this, e);
}, gp.prototype.U = function(e) {
	if (this.t !== void 0 && (dp.prototype.U.call(this, e), this.t === void 0)) {
		this.f &= -33;
		for (var t = this.s; t !== void 0; t = t.n) t.S.U(t);
	}
}, gp.prototype.N = function() {
	if (!(2 & this.f)) {
		this.f |= 6;
		for (var e = this.t; e !== void 0; e = e.x) e.t.N();
	}
}, Object.defineProperty(gp.prototype, "value", { get: function() {
	if (1 & this.f) throw Error("Cycle detected");
	var e = up(this);
	if (this.h(), e !== void 0 && (e.i = this.i), 16 & this.f) throw this.v;
	return this.v;
} });
function _p(e) {
	var t = e.m;
	if (e.m = void 0, typeof t == "function") {
		ip++;
		var n = tp;
		tp = void 0;
		try {
			t();
		} catch (t) {
			throw e.f &= -2, e.f |= 8, vp(e), t;
		} finally {
			tp = n, Qf();
		}
	}
}
function vp(e) {
	for (var t = e.s; t !== void 0; t = t.n) t.S.U(t);
	e.x = void 0, e.s = void 0, _p(e);
}
function yp(e) {
	if (tp !== this) throw Error("Out-of-order effect");
	hp(this), tp = e, this.f &= -2, 8 & this.f && vp(this), Qf();
}
function bp(e, t) {
	this.x = e, this.m = void 0, this.s = void 0, this.u = void 0, this.f = 32, this.name = t?.name, ep && ep.push(this);
}
bp.prototype.c = function() {
	var e = this.S();
	try {
		if (8 & this.f || this.x === void 0) return;
		var t = this.x();
		typeof t == "function" && (this.m = t);
	} finally {
		e();
	}
}, bp.prototype.S = function() {
	if (1 & this.f) throw Error("Cycle detected");
	this.f |= 1, this.f &= -9, _p(this), mp(this), ip++;
	var e = tp;
	return tp = this, yp.bind(this, e);
}, bp.prototype.N = function() {
	2 & this.f || (this.f |= 2, this.u = rp, rp = this);
}, bp.prototype.d = function() {
	this.f |= 8, 1 & this.f || vp(this);
}, bp.prototype.dispose = function() {
	this.d();
};
function xp(e, t) {
	var n = new bp(e, t);
	try {
		n.c();
	} catch (e) {
		throw n.d(), e;
	}
	var r = n.d.bind(n);
	return r[Symbol.dispose] = r, r;
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+extension@0.52.0_typescript@5.9.3/node_modules/@lexical/extension/dist/LexicalExtensionWatchedSignal.prod.js
function Sp(e, t) {
	let n;
	return fp(e(), {
		unwatched() {
			n &&= (n(), void 0);
		},
		watched() {
			this.value = e(), n = t(this);
		}
	});
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+html@0.52.0_typescript@5.9.3/node_modules/@lexical/html/dist/LexicalHtml.prod.js
function Cp(e, ...t) {
	throw function(e, ...t) {
		let n = new URL("https://lexical.dev/docs/error"), r = new URLSearchParams();
		r.append("code", e);
		for (let e of t) r.append("v", e);
		return n.search = r.toString(), /* @__PURE__ */ Error(`Minified Lexical error #${e}; visit ${n.toString()} for the full message or use the non-minified dev environment for full errors and additional helpful warnings.`);
	}(e, ...t);
}
var wp;
function Tp(e, t) {
	let { key: n } = t;
	return e && n in e ? e[n] : t.defaultValue;
}
function Ep(e) {
	return wp && wp.editor === e ? wp : void 0;
}
function Dp(e, t) {
	if ("cfg" in t) {
		let { cfg: n, updater: r } = t;
		return [n, r(Tp(e, n))];
	}
	return t;
}
function Op(e, t) {
	let n = t;
	for (let r of e) {
		let [e, i] = Dp(n, r), a = e.key;
		if (n === t && Tp(n, e) === i) continue;
		let o = n === t || n === void 0 ? kp(t) : n;
		o[a] = i, n = o;
	}
	return n;
}
function kp(e) {
	return Object.create(e || null);
}
function Ap(e, t) {
	return [e, t];
}
function jp(e, t, n, r = J()) {
	let i = wp, a = Ep(r);
	try {
		return wp = {
			...a,
			editor: r,
			[e]: t
		}, n();
	} finally {
		wp = i;
	}
}
function Mp(e, t = () => {}) {
	return (n, r = J()) => (i) => {
		let a = Ep(r), o = a && a[e], s = Op(n, o || t(r));
		return s && s !== o ? jp(e, s, i, r) : i();
	};
}
function Np(e, t, n, r) {
	return Object.assign(Vt(Symbol(t), {
		isEqual: r,
		parse: n
	}), { [e]: !0 });
}
var Pp = "@lexical/html/DOM", Fp = Symbol.for("@lexical/html/DOMExportContext");
function Ip(e, t, n) {
	return Np(Fp, e, t, n);
}
var Lp = /* @__PURE__ */ Ip("isExport", Boolean);
function Rp(e) {
	let t = Bf(e, Pp);
	return t ? t.output.defaults : void 0;
}
function zp(e) {
	let t = Bf(e, Pp);
	return t ? t.output.runtime : void 0;
}
function Bp(e = J()) {
	let t = zp(e);
	return t ? t.getSessionConfig() : Y(e);
}
var Vp = /* @__PURE__ */ Mp(Fp, Rp);
function Hp(e, t = null, n = J()) {
	return Vp([Ap(Lp, !0)], n)(() => {
		let r = Mc(), i = Bp(n), a = Ru(t), o = e.append.bind(e);
		for (let e of (B(a) ? a : r).getChildren()) Wp(n, e, o, t, i);
		return e;
	});
}
function Up(e, t = null) {
	return (typeof document > "u" || typeof window > "u" && global.window === void 0) && Cp(338), Bo(e), Hp(El().createElement("div"), t, e).innerHTML;
}
function Wp(e, t, n, r = null, i = Y(e)) {
	let a = i.$shouldInclude(t, r, e), o = i.$shouldExclude(t, r, e), s = t;
	r !== null && N(t) && (s = Uf(r, t, "clone"));
	let { element: c, after: l, append: u, $getChildNodes: d } = i.$exportDOM(s, e);
	if (!c) return !1;
	let f = El().createDocumentFragment(), p = d ? d() : B(s) ? s.getChildren() : [], m = a && Ha(r) && B(t) ? null : r, h = f.append.bind(f), g = null;
	for (let n of p) {
		let o = Wp(e, n, h, m, i);
		o && (g = n), !a && o && i.$extractWithChild(t, n, r, "html", e) && (a = !0);
	}
	if (a && !o) {
		if ((W(c) || Ll(c)) && (u ? u(f) : c.append(f), function(e, t) {
			let n = e.lastChild;
			if (Cs(t) && W(e) && K(e) && n !== null && n.nodeName === "BR") {
				let t = El().createElement("br");
				t.setAttribute("data-lexical-managed-linebreak", "true"), e.append(t);
			}
		}(c, g)), Ll(c)) {
			if (l) {
				let e = l.call(s, c);
				e && c.replaceChildren(e);
			}
			n(c);
		} else if (n(c), l) {
			let e = l.call(s, c);
			e && c.replaceWith(e);
		}
	} else n(f);
	return a;
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+clipboard@0.52.0_typescript@5.9.3/node_modules/@lexical/clipboard/dist/LexicalClipboard.prod.js
function Gp(e, t, n = null) {
	let r = Tl(n), i = n ? Cl(n) : [], a = n !== null && i.length > 0;
	if (a && typeof r.caretPositionFromPoint == "function") {
		let a = r.caretPositionFromPoint(e, t, { shadowRoots: i });
		if (a !== null && function(e, t) {
			for (let n = e; n !== null;) {
				if (n === t) return !0;
				n = el(n);
			}
			return !1;
		}(a.offsetNode, n)) return {
			node: a.offsetNode,
			offset: a.offset
		};
	}
	if (a) {
		let i = n.getRootNode();
		if (xl(i)) {
			let a = i.elementFromPoint(e, t);
			if (a !== null && n.contains(a)) {
				let n = function(e, t, n, r) {
					let i = r.createRange(), a = (e) => t < e.top ? e.top - t : t > e.bottom ? t - e.bottom : 0, o = (t) => e < t.left ? t.left - e : e > t.right ? e - t.right : 0, s = r.createTreeWalker(n, NodeFilter.SHOW_TEXT), c = null, l = Infinity, u = Infinity;
					for (let e = s.nextNode(); e; e = s.nextNode()) {
						i.selectNodeContents(e);
						for (let t of i.getClientRects()) {
							let n = a(t), r = o(t);
							(n < l || n === l && r < u) && (l = n, u = r, c = e);
						}
					}
					if (c === null) return null;
					let d = 0, f = Infinity, p = Infinity;
					for (let t = 0; t <= c.length; t++) {
						i.setStart(c, t), i.collapse(!0);
						let n = i.getBoundingClientRect(), r = a(n), o = Math.abs(e - n.left);
						(r < f || r === f && o < p) && (f = r, p = o, d = t);
					}
					return {
						node: c,
						offset: d
					};
				}(e, t, a, r);
				if (n !== null) return n;
			}
		}
	}
	if (typeof r.caretRangeFromPoint == "function") {
		let n = r.caretRangeFromPoint(e, t);
		return n === null ? null : {
			node: n.startContainer,
			offset: n.startOffset
		};
	}
	if (typeof r.caretPositionFromPoint == "function") {
		let n = r.caretPositionFromPoint(e, t);
		return n === null ? null : {
			node: n.offsetNode,
			offset: n.offset
		};
	}
	return null;
}
function Kp(e, ...t) {
	throw function(e, ...t) {
		let n = new URL("https://lexical.dev/docs/error"), r = new URLSearchParams();
		r.append("code", e);
		for (let e of t) r.append("v", e);
		return n.search = r.toString(), /* @__PURE__ */ Error(`Minified Lexical error #${e}; visit ${n.toString()} for the full message or use the non-minified dev environment for full errors and additional helpful warnings.`);
	}(e, ...t);
}
function qp(e, t = F()) {
	return t ?? Kp(166), P(t) && t.isCollapsed() || t.getNodes().length === 0 ? "" : Up(e, t);
}
function Jp(e, t) {
	let n = e.getData("text/plain") || e.getData("text/uri-list");
	n != null && t.insertRawText(n);
}
var Yp = "application/x-lexical-drag";
function Xp(e, t) {
	let n = { editorKey: t.getKey() };
	e.setData(Yp, JSON.stringify(n));
}
function Zp(e) {
	let t = e;
	if (ad(t)) {
		if (t.offset === 0) t = Ms(t.getSiblingCaret());
		else {
			if (t.offset !== t.origin.getTextContentSize()) return t;
			t = t.getSiblingCaret();
		}
	}
	for (;;) {
		let e = t.getParentAtCaret();
		if (e === null || !e.isInline() || e.isShadowRoot()) return t;
		if (sd(t)) t = Ms(dd(e, "next"));
		else {
			if (t.getNodeAtCaret() !== null) return t;
			t = dd(e, "next");
		}
	}
}
function Qp(e, t, n) {
	let r = e.dataTransfer;
	if (r === null) return !1;
	let i = function(e) {
		let t = e.getData(Yp);
		if (!t) return null;
		let n;
		try {
			n = JSON.parse(t);
		} catch {
			return null;
		}
		return (r = n) !== null && typeof r == "object" && "editorKey" in r && typeof r.editorKey == "string" ? n : null;
		var r;
	}(r);
	if (i === null) return !1;
	let a = function(e, t) {
		let n = Gp(e.clientX, e.clientY, t.getRootElement());
		if (n === null) return null;
		let r = kc(n.node);
		if (r === null) return null;
		if (N(r)) return fd(r, "next", n.offset);
		if (B(r)) return zs(r, n.offset, "next");
		let i = r.getParent();
		return i === null ? null : zs(i, r.getIndexWithinParent() + 1, "next");
	}(e, t);
	if (a === null) return !1;
	let o = i.editorKey === t.getKey(), s = F();
	if (o) {
		if (!P(s) || s.isCollapsed()) return !1;
		if (function(e, t) {
			let { anchor: n, focus: r } = Rs(js(t), "next"), i = Zp(e);
			return wd(Zp(n), i) <= 0 && wd(i, Zp(r)) <= 0;
		}(a, s)) return e.preventDefault(), !0;
	}
	let c = Is(a), l = ad(c) ? Hs(c) : c;
	if (l === null) return !1;
	let u = l.getFlipped();
	o && P(s) && s.removeText();
	let d = l.origin.isAttached() ? l : u;
	if (d.origin.isAttached() || Kp(438), n(r, ks(xd(d)), t), !o) {
		let e = t.getRootElement(), n = e ? e.ownerDocument : null, r = n ? function(e, t) {
			for (let n of wl(t)) {
				let t = mc(n);
				if (fc(t) && t.getKey() === e && W(n)) return n;
			}
			return null;
		}(i.editorKey, n) : null;
		r !== null && r.dispatchEvent(new InputEvent("beforeinput", {
			bubbles: !0,
			cancelable: !0,
			inputType: "deleteByDrag"
		}));
	}
	return e.preventDefault(), !0;
}
function $p(e, t) {
	return Qp(e, t, (e, t) => Jp(e, t));
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+extension@0.52.0_typescript@5.9.3/node_modules/@lexical/extension/dist/LexicalExtensionNamedSignals.prod.js
function em(e, t = {}) {
	let n = {};
	for (let r in e) {
		let i = t[r];
		n[r] = fp(i === void 0 ? e[r] : i);
	}
	return n;
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+dragon@0.52.0_typescript@5.9.3/node_modules/@lexical/dragon/dist/LexicalDragon.prod.js
var tm = {
	bold: "bold",
	italic: "italic",
	strikeThrough: "strikethrough",
	subscript: "subscript",
	superscript: "superscript",
	underline: "underline"
}, nm = Symbol.for("@lexical/dragon/WindowState");
function rm(e, t, n) {
	let r = function(e) {
		let t = e[nm];
		return t === void 0 && (t = {
			dispose: () => {},
			editors: /* @__PURE__ */ new Map(),
			installs: /* @__PURE__ */ new Set()
		}, e[nm] = t), t;
	}(e);
	if (r.installs.size === 0) {
		let t = sm.bind(e);
		e.addEventListener("message", t, !0), r.dispose = () => {
			e.removeEventListener("message", t, !0);
		};
	}
	if (r.installs.add(t), n) {
		let e = r.editors.get(n) || /* @__PURE__ */ new Set();
		e.add(t), r.editors.set(n, e);
	}
	return im.bind(null, e, r, t, n);
}
function im(e, t, n, r) {
	if (r) {
		let e = t.editors.get(r);
		e && e.delete(n) && e.size === 0 && t.editors.delete(r);
	}
	t.installs.delete(n) && t.installs.size === 0 && (t.dispose(), delete e[nm]);
}
function am(e) {
	return e && e.ownerDocument.defaultView;
}
function om(e) {
	let t = Sp(() => am(e.getRootElement()), (t) => e.registerRootListener((e) => {
		t.value = am(e);
	}));
	return xp(() => {
		let n = t.value;
		if (n) return rm(n, Symbol("@lexical/dragon/editorInstall"), e);
	});
}
function sm(e) {
	if (e.origin !== this.location.origin) return;
	let t = function(e) {
		let t = e[nm];
		if (t === void 0) return null;
		let n = mc(Pl(e.document));
		return fc(n) && t.editors.has(n) ? n : null;
	}(this);
	if (t === null) return;
	let n = e.data;
	if (typeof n == "string") {
		let r;
		try {
			r = JSON.parse(n);
		} catch {
			return;
		}
		if (r && r.protocol === "nuanria_messaging" && r.type === "request") {
			let n = r.payload;
			if (n && n.functionId === "makeChanges") {
				let r = n.args;
				if (Array.isArray(r)) {
					let [n, i, a, o, s, c] = r;
					if (![
						n,
						i,
						o,
						s
					].every(Number.isFinite) || typeof a != "string" && a !== -1) return;
					t.update(() => {
						let t = F();
						if (P(t)) {
							let r = t.anchor, l = r.getNode(), u = 0, d = 0;
							if (N(l) && n >= 0 && i >= 0 && (u = n, d = n + i, t.setTextNodeRange(l, u, l, d)), typeof a != "string" || u === d && a === "" || (t.insertRawText(a), l = r.getNode()), N(l)) {
								let e = l.getTextContentSize();
								u = Math.min(Math.max(o, 0), e), d = o < 0 || s < 0 ? u : Math.min(o + s, e), t.setTextNodeRange(l, u, l, d);
							}
							if (typeof c == "string" && s > 0 && !t.isCollapsed()) {
								let e = tm[c];
								e !== void 0 && t.formatText(e);
							}
							e.stopImmediatePropagation();
						}
					});
				}
			}
		}
	}
}
var cm = {
	build: (e, t, n) => em(t),
	config: { disabled: typeof window > "u" },
	name: "@lexical/dragon",
	register: (e, t, n) => xp(() => n.getOutput().disabled.value ? void 0 : om(e))
};
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+extension@0.52.0_typescript@5.9.3/node_modules/@lexical/extension/dist/LexicalExtensionNormalizeInlineElementsExtension.prod.js
function lm(e) {
	B(e) && e.isInline() && e.isEmpty() && e.remove();
}
var um = {
	build: (e, t, n) => em(t),
	config: { disabled: !1 },
	name: "@lexical/NormalizeInlineElements",
	register: (e, t, n) => {
		let r = n.getOutput();
		return xp(() => {
			if (!r.disabled.value) {
				let t = [];
				for (let { klass: n, transforms: r } of e._nodes.values()) n.prototype instanceof ls && n.prototype.isInline !== ls.prototype.isInline && (r.add(lm), t.push(() => r.delete(lm)));
				return () => t.forEach((e) => e());
			}
		});
	}
}, dm = /* @__PURE__ */ new Set([Xi, Ji]), fm = {
	build: (e, t, n) => em(t),
	config: {
		$fixFocusOverselection: function() {
			let e = F();
			if (P(e) && !e.isCollapsed()) {
				let t = Rs(js(e), "next"), n = t.focus;
				for (ad(n) && t.anchor.origin !== n.origin && n.offset === 0 && (n = Ms(n.getSiblingCaret())), od(n) && t.anchor.origin !== n.origin && Cs(n.origin) && (n = Ms(n)); sd(n) && t.anchor.origin !== n.origin;) n = Ms(dd(n.origin, "next"));
				if (od(n) && B(n.origin) && (n = Is(hd(n.origin, "previous")).getFlipped()), n = Is(n), !n.isSamePointCaret(t.focus)) {
					let e = ks(Sd(t.anchor, n)), r = J().getRootElement(), i = r && yl(r.ownerDocument.defaultView);
					i && vo(po(), e, J(), i, dm, r);
				}
			}
		},
		dateNow: () => Date.now(),
		disabled: !1,
		thresholdMsec: 100
	},
	name: "@lexical/NormalizeTripleClickSelection",
	register: (e, t, n) => xp(() => {
		let t = n.getOutput();
		if (!t.disabled.value) return e.registerRootListener((n) => {
			if (!n) return;
			let r = 0, i = (e) => {
				if (e ? e.detail > 2 : r > 0) {
					let n = t.dateNow.peek()();
					r = e && e.type === "mousedown" || n - r <= t.thresholdMsec.peek() ? n : 0;
				}
				return r;
			};
			return Nd(e.registerCommand(rr, () => (i(null) && (r = 0, t.$fixFocusOverselection.peek()()), !1), -4), Q(n, {
				mousedown: i,
				mouseup: i
			}, !0));
		});
	})
};
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+plain-text@0.52.0_typescript@5.9.3/node_modules/@lexical/plain-text/dist/LexicalPlainText.prod.js
function pm(e, t) {
	t.update(() => {
		if (e !== null) {
			let n = Xf(e, KeyboardEvent) ? null : e.clipboardData, r = F();
			if (r !== null && !r.isCollapsed() && n != null) {
				e.preventDefault();
				let i = qp(t);
				i !== null && n.setData("text/html", i), n.setData("text/plain", r.getTextContent());
			}
		}
	});
}
function mm(e) {
	return Nd(e.registerCommand(lr, (e) => {
		let t = F();
		return !!P(t) && (t.deleteCharacter(e), !0);
	}, 0), e.registerCommand(hr, (e) => {
		let t = F();
		return !!P(t) && (t.deleteWord(e), !0);
	}, 0), e.registerCommand(gr, (e) => {
		let t = F();
		return !!P(t) && (t.deleteLine(e), !0);
	}, 0), e.registerCommand(fr, (e) => {
		let t = F();
		if (!P(t)) return !1;
		if (typeof e == "string") t.insertText(e);
		else {
			let n = e.dataTransfer;
			if (n != null) Jp(n, t);
			else {
				let n = e.data;
				n && t.insertText(n);
			}
		}
		return !0;
	}, 0), e.registerCommand(mr, () => {
		let e = F();
		return !!P(e) && (e.removeText(), !0);
	}, 0), e.registerCommand(ur, (e) => {
		let t = F();
		return !!P(t) && (t.insertLineBreak(e), !0);
	}, 0), e.registerCommand(dr, () => {
		let e = F();
		return !!P(e) && (e.insertLineBreak(), !0);
	}, 0), e.registerCommand(Cr, (e) => {
		let t = F();
		if (!P(t)) return !1;
		let n = e, r = n.shiftKey;
		return !!Kf(t, !0) && (n.preventDefault(), Yf(t, r, !0), !0);
	}, 0), e.registerCommand(xr, (e) => {
		let t = F();
		if (!P(t)) return !1;
		let n = e, r = n.shiftKey;
		return !!Kf(t, !1) && (n.preventDefault(), Yf(t, r, !1), !0);
	}, 0), e.registerCommand(kr, (t) => !!P(F()) && (!ve || !ge) && (t.preventDefault(), e.dispatchCommand(lr, !0)), 0), e.registerCommand(jr, (t) => !!P(F()) && (t.preventDefault(), e.dispatchCommand(lr, !1)), 0), e.registerCommand(Dr, (t) => {
		if (!P(F())) return !1;
		if (t !== null) {
			if ((ve || be || Ce) && ge) return !1;
			t.preventDefault();
		}
		return e.dispatchCommand(ur, !1);
	}, 0), e.registerCommand(zr, () => {
		let e = F();
		return Kc(P(e) && Lu(e.anchor.getNode()) !== null ? e : null), !0;
	}, 0), e.registerCommand(Lr, (t) => !!P(F()) && (pm(t, e), !0), 0), e.registerCommand(Rr, (t) => !!P(F()) && (function(e, t) {
		pm(e, t), t.update(() => {
			let e = F();
			P(e) && e.removeText();
		}, { tag: "cut" });
	}(t, e), !0), 0), e.registerCommand(pr, (t) => !!P(F()) && (function(e, t) {
		e.preventDefault(), t.update(() => {
			let t = F(), n = Xf(e, ClipboardEvent) ? e.clipboardData : null;
			n != null && P(t) && Jp(n, t);
		}, { tag: "paste" });
	}(t, e), !0), 0), e.registerCommand(Nr, (t) => $p(t, e), 0), e.registerCommand(Pr, (t) => {
		let n = F();
		return !!P(n) && (n.isCollapsed() || t.dataTransfer === null || Xp(t.dataTransfer, e), !0);
	}, 0));
}
var hm = {
	conflictsWith: ["@lexical/rich-text"],
	dependencies: [
		cm,
		um,
		fm
	],
	name: "@lexical/plain-text",
	register: mm
};
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+history@0.52.0_typescript@5.9.3/node_modules/@lexical/history/dist/LexicalHistory.prod.js
function gm(e, t, n) {
	let r = n(), i = 0, a = r, o = 0, s = null;
	return (c, l, u, d, f, p) => {
		let m = n();
		if (p.has("composition-start") && (a = r, o = i, s = c), p.has("historic")) return i = 0, r = m, 2;
		p.has("composition-end") && s && (r = a, i = o, c = s);
		let h = p.has("paste") || p.has("cut") ? 0 : function(e, t, n, r, i) {
			if (e === null || n.size === 0 && r.size === 0 && !i) return 0;
			let a = t._selection, o = e._selection;
			if (i) return 1;
			if (!(P(a) && P(o) && o.isCollapsed() && a.isCollapsed())) return 0;
			let s = function(e, t, n) {
				let r = e._nodeMap, i = [];
				for (let e of t) {
					let t = r.get(e);
					t !== void 0 && i.push(t);
				}
				for (let [e, t] of n) {
					if (!t) continue;
					let n = r.get(e);
					n === void 0 || ps(n) || i.push(n);
				}
				return i;
			}(t, n, r);
			if (s.length === 0) return 0;
			if (s.length > 1) {
				let n = t._nodeMap, r = n.get(a.anchor.key), i = n.get(o.anchor.key);
				return r && i && !e._nodeMap.has(r.__key) && N(r) && r.__text.length === 1 && a.anchor.offset === 1 ? 2 : 0;
			}
			let c = s[0], l = e._nodeMap.get(c.__key);
			if (!N(l) || !N(c) || l.__mode !== c.__mode) return 0;
			let u = l.__text, d = c.__text;
			if (u === d) return 0;
			let f = a.anchor, p = o.anchor;
			if (f.key !== p.key || f.type !== "text") return 0;
			let m = f.offset, h = p.offset, g = d.length - u.length;
			return g === 1 && h === m - 1 ? 2 : g === -1 && h === m + 1 ? 3 : g === -1 && h === m ? 4 : 0;
		}(c, l, d, f, e.isComposing()), g = (() => {
			let n = u === null || u.editor === e, a = p.has(Ki);
			if (!a && n && p.has("history-merge")) return 0;
			if (h === 1) return 2;
			if (c === null) return 1;
			let o = l._selection;
			if (!(d.size > 0 || f.size > 0)) return o === null ? 2 : 0;
			let s = typeof t == "number" ? t : t.peek();
			return !1 === a && h !== 0 && h === i && m < r + s && n || d.size === 1 && function(e, t, n) {
				let r = t._nodeMap.get(e), i = n._nodeMap.get(e), a = t._selection, o = n._selection;
				return !(P(a) && P(o) && a.anchor.type === "element" && a.focus.type === "element" && o.anchor.type === "text" && o.focus.type === "text" || !N(r) || !N(i) || r.__parent !== i.__parent) && JSON.stringify(t.read(() => r.exportJSON())) === JSON.stringify(n.read(() => i.exportJSON()));
			}(Array.from(d)[0], c, l) ? 0 : 1;
		})();
		return r = m, i = h, g;
	};
}
function _m(e, t) {
	if (t !== null && t.editor === e.editor) return t;
	let { editor: n } = e, r = n.getEditorState();
	return r.isEmpty() ? null : {
		editor: n,
		editorState: r
	};
}
function vm(e, t) {
	e.undoStack = [], e.redoStack = [], e.current = null, t && t(e);
}
function ym(e, t, n, r = Date.now, i, a = null) {
	let o = gm(e, n, r), s = () => {
		i && i(t);
	};
	return s(), Nd(e.registerCommand(vr, () => (function(e, t, n) {
		let r = t.redoStack, i = t.undoStack;
		if (i.length !== 0) {
			let a = t.current, o = i.pop();
			if (o) {
				let t = _m(o, a);
				t !== null && (r.push(t), e.dispatchCommand(Hr, !0));
			}
			i.length === 0 && e.dispatchCommand(Ur, !1), t.current = o || null, n && n(t), o && o.editor.setEditorState(o.editorState, { tag: "historic" });
		}
	}(e, t, i), !0), 0), e.registerCommand(yr, () => (function(e, t, n) {
		let r = t.redoStack, i = t.undoStack;
		if (r.length !== 0) {
			let a = t.current, o = r.pop();
			if (o) {
				let t = _m(o, a);
				t !== null && (i.push(t), e.dispatchCommand(Ur, !0));
			}
			r.length === 0 && e.dispatchCommand(Hr, !1), t.current = o || null, n && n(t), o && o.editor.setEditorState(o.editorState, { tag: "historic" });
		}
	}(e, t, i), !0), 0), e.registerCommand(Br, () => (vm(t, i), !1), 0), e.registerCommand(Vr, () => (vm(t, i), e.dispatchCommand(Hr, !1), e.dispatchCommand(Ur, !1), !0), 0), e.registerUpdateListener(({ editorState: n, prevEditorState: r, dirtyLeaves: i, dirtyElements: c, tags: l }) => {
		let u = t.current, d = t.redoStack, f = t.undoStack, p = u === null ? null : u.editorState;
		if (u !== null && n === p) return;
		let m = o(r, n, u, i, c, l);
		if (m === 1) {
			d.length !== 0 && (t.redoStack = [], e.dispatchCommand(Hr, !1));
			let n = function(e, t, n) {
				return n === null ? null : n.editor === e ? { ...n } : t.isEmpty() ? null : {
					editor: e,
					editorState: t
				};
			}(e, r, u);
			if (n !== null) {
				f.push(n);
				let t = typeof a == "number" || a === null ? a : a.peek();
				t !== null && f.length > t && f.splice(0, f.length - t), e.dispatchCommand(Ur, !0);
			}
		} else if (m === 2) return;
		t.current = {
			editor: e,
			editorState: n
		}, s();
	}));
}
function bm() {
	return {
		current: null,
		redoStack: [],
		undoStack: []
	};
}
var xm = {
	build: (e, { delay: t, createInitialHistoryState: n, disabled: r, maxDepth: i, now: a }, o) => ({
		...em({
			delay: t,
			disabled: r,
			historyState: n(e),
			maxDepth: i,
			now: a
		}),
		...o.getInitResult()
	}),
	config: {
		createInitialHistoryState: bm,
		delay: 300,
		disabled: typeof window > "u",
		maxDepth: null,
		now: () => Date.now()
	},
	init: () => ({
		canRedo: fp(!1),
		canUndo: fp(!1)
	}),
	name: "@lexical/history/History",
	register: (e, t, n) => {
		let { canUndo: r, canRedo: i } = n.getInitResult(), a = n.getOutput(), o = (e) => $f(() => {
			r.value = e != null && e.undoStack.length > 0, i.value = e != null && e.redoStack.length > 0;
		});
		return xp(() => {
			if (!a.disabled.value) return ym(e, a.historyState.value, a.delay, () => a.now.peek()(), o, a.maxDepth);
			o(null);
		});
	}
};
//#endregion
//#region ../../../../design/browser-ui/src/rich-input/document.ts
function Sm() {
	return Mc().getChildren().map((e) => e.getTextContent()).join("\n");
}
function Cm(e, t = []) {
	let n = Mc();
	n.clear();
	let r = 0;
	for (let i of e.split("\n")) {
		let e = qs(), a = 0;
		for (let n of t) {
			let t = n.range.start - r, o = n.range.end - r;
			t < a || o <= t || o > i.length || (t > a && e.append(Da(i.slice(a, t))), e.append(n.create(i.slice(t, o))), a = o);
		}
		a < i.length && e.append(Da(i.slice(a))), n.append(e), r += i.length + 1;
	}
	n.selectEnd();
}
function wm() {
	Cm(""), Pc(null);
}
function Tm(e, t) {
	let n = lo();
	function r(e, t) {
		let n = 0, r = Mc().getChildren();
		for (let i of r) {
			let r = i.getTextContentSize();
			if (t <= n + r && B(i)) {
				function r(t, n) {
					if (!B(t)) return;
					let i = t.getChildren();
					for (let a = 0; a < i.length; a++) {
						let o = i[a], s = o.getTextContentSize();
						if (n <= s) {
							N(o) ? e.set(o.getKey(), n, "text") : B(o) ? r(o, n) : e.set(t.getKey(), a + +(n > 0), "element");
							return;
						}
						n -= s;
					}
					e.set(t.getKey(), i.length, "element");
				}
				r(i, t - n);
				return;
			}
			n += r + 1;
		}
		let i = r.at(-1);
		B(i) && e.set(i.getKey(), i.getChildrenSize(), "element");
	}
	return r(n.anchor, e), r(n.focus, t), Pc(n), n;
}
//#endregion
//#region ../../../../design/browser-ui/src/rich-input/core.tsx
var Em = "parent-rich-input-reset", Dm = kd({
	name: "TmtRichInput",
	namespace: "TmtRichInput",
	nodes: [ff],
	dependencies: [
		hm,
		xm,
		Rf
	],
	$initialEditorState: wm,
	onError: (e) => {
		throw e;
	}
});
function Om(e) {
	return /* @__PURE__ */ (0, $.jsxs)(zf, {
		extension: Dm,
		contentEditable: null,
		children: [/* @__PURE__ */ (0, $.jsx)(km, { ...e }), e.children]
	});
}
function km(e) {
	let [t] = se(), n = (0, y.useRef)(e);
	n.current = e;
	let r = (0, y.useRef)(e.resetKey);
	(0, y.useEffect)(() => {
		if (e.autoFocus) return t.registerRootListener((e) => {
			e && t.focus(() => e.focus({ preventScroll: !0 }));
		});
	}, [t, e.autoFocus]);
	let i = (0, y.useRef)(e.disabled);
	(0, y.useEffect)(() => {
		let n = i.current && !e.disabled;
		i.current = e.disabled, t.setEditable(!e.disabled), n && e.autoFocus && t.getRootElement()?.closest("dialog[open], .tmt-ui-panel") && document.activeElement === document.body && t.focus();
	}, [
		t,
		e.disabled,
		e.autoFocus
	]), (0, y.useLayoutEffect)(() => {
		let n = r.current !== e.resetKey;
		r.current = e.resetKey;
		let i = t.getEditorState().read(() => e.document.read(e.edit));
		if (n || i.value !== e.edit.value) {
			let n = t.getRootElement()?.contains(document.activeElement) ?? !1;
			t.update(() => {
				e.document.replace(e.edit), n || Pc(null);
			}, {
				tag: n ? Em : [Em, Yi],
				discrete: !0
			}), t.dispatchCommand(Vr, void 0);
		}
	}, [
		t,
		e.edit,
		e.document,
		e.resetKey
	]);
	let [, a] = (0, y.useReducer)((e) => e + 1, 0);
	return (0, y.useLayoutEffect)(a, [a]), (0, y.useEffect)(() => t.registerUpdateListener(({ editorState: e, tags: t, dirtyElements: r, dirtyLeaves: i }) => {
		if (t.has("parent-rich-input-reset") || !(r.size || i.size)) return;
		let a = n.current, o = e.read(() => a.document.read(a.edit));
		a.document.equal(o, a.edit) || a.onChange(o);
	}), [t]), null;
}
//#endregion
//#region ../../../../design/browser-ui/src/rich-input-control/control.tsx
function Am(e) {
	let [t] = se(), n = (0, y.useId)();
	return /* @__PURE__ */ (0, $.jsx)(Jd, {
		controlId: n,
		label: e.label,
		describedByIds: e.describedBy ? [e.describedBy] : [],
		renderControl: (n) => {
			let r = /* @__PURE__ */ (0, $.jsx)(sf, {
				...e.trigger,
				...n,
				onKeyDown: void 0,
				placeholder: null,
				"aria-placeholder": void 0,
				className: `${n.className} rich-input-field ${e.className ?? ""}`,
				"aria-multiline": "true",
				"aria-disabled": e.disabled && !e.busy,
				"aria-busy": e.busy || void 0,
				ref: e.trigger?.ref,
				"data-placeholder": e.placeholder,
				onKeyDownCapture: (n) => {
					let r = n.nativeEvent;
					!r.isTrusted || r.isComposing || t.isComposing() || r.keyCode === 229 || e.disabled || e.onKeyDownCapture?.(n);
				}
			});
			return /* @__PURE__ */ (0, $.jsxs)("div", {
				className: "rich-input-surface",
				"data-accessory": !!e.accessory || void 0,
				"data-disabled": e.disabled && !e.busy || void 0,
				children: [
					e.header,
					r,
					e.accessory && /* @__PURE__ */ (0, $.jsx)("div", {
						className: "rich-input-accessory",
						children: e.accessory
					})
				]
			});
		}
	});
}
//#endregion
//#region src/ops-composer.ts
var jm = {
	read: () => ({ value: Sm() }),
	replace: (e) => Cm(e.value),
	equal: (e, t) => e.value === t.value
};
function Mm() {
	let [e] = se();
	return (0, y.createElement)(Zd, {
		type: "button",
		variant: "text",
		label: "Mention an agent",
		icon: (0, y.createElement)(ne),
		onActivate: (t) => {
			t.isTrusted && (e.update(() => {
				let e = F();
				if (!P(e)) {
					let t = Sm().length;
					Tm(t, t), e = F();
				}
				P(e) && e.insertText("@");
			}, {
				tag: Ki,
				discrete: !0
			}), e.focus());
		}
	});
}
function Nm({ options: e }) {
	let [t, n] = (0, y.useState)({}), [r, i] = (0, y.useState)(0), a = (0, y.useRef)(e.cleared);
	(0, y.useEffect)(() => {
		a.current !== e.cleared && (a.current = e.cleared, n((t) => ({
			...t,
			[e.key]: ""
		})), e.onDraft?.(e.key, ""), i((e) => e + 1));
	}, [e.cleared, e.key]);
	let o = t[e.key] ?? e.saved ?? "", s = e.canSend && !e.busy && o.trim() !== "", c = () => {
		s && e.onSend?.(o);
	}, l = (0, y.createElement)(Am, {
		label: e.label,
		placeholder: e.placeholder,
		disabled: e.busy,
		busy: e.busy,
		className: "ops-composer-field",
		describedBy: e.describedBy,
		accessory: (0, y.createElement)("div", { className: "ops-composer-actions" }, (0, y.createElement)(Mm), (0, y.createElement)("span", { className: "ops-composer-hint" }, e.hint), (0, y.createElement)(Zd, {
			type: "button",
			variant: "primary",
			label: "Send",
			icon: (0, y.createElement)(ee),
			disabled: !s,
			busy: e.busy,
			...e.canSend ? {} : { disabledReasonId: e.describedBy },
			onActivate: (e) => {
				e.isTrusted && c();
			}
		})),
		onKeyDownCapture: (e) => {
			e.key !== "Enter" || e.shiftKey || (e.preventDefault(), e.stopPropagation(), c());
		}
	});
	return (0, y.createElement)(Om, {
		edit: { value: o },
		onChange: (t) => {
			n((n) => ({
				...n,
				[e.key]: t.value
			})), e.onDraft?.(e.key, t.value);
		},
		document: jm,
		disabled: e.busy,
		resetKey: `${e.key}:${r}`,
		children: l
	});
}
function Pm(e, t) {
	let n = (0, ae.createRoot)(e), r = (e) => n.render((0, y.createElement)(Nm, { options: e }));
	return r(t), {
		update: r,
		unmount: () => n.unmount()
	};
}
//#endregion
export { Pm as mountComposer };
