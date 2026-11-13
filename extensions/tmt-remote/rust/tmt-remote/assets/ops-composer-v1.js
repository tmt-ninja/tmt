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
				e = (e = t.documentElement) && (e = e.namespaceURI) ? Hd(e) : 0;
				break;
			default: if (e = t.tagName, t = t.namespaceURI) t = Hd(t), e = Ud(t, e);
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
		var t = he.current, n = Ud(t, e.type);
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
				if (n = t.alternate, t.child !== null || n !== null && n.child !== null) for (e = ff(e); e !== null;) {
					if (n = e[gt]) return n;
					e = ff(e);
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
			if (mn = !1, (A !== null || fn !== null) && (Su(), A && (t = A, e = fn, fn = A = null, pn(t), e))) for (t = 0; t < e.length; t++) pn(e[t]);
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
		A ? fn ? fn.push(r) : fn = [r] : A = r, t = Od(t, "onChange"), 0 < t.length && (n = new kn("onChange", "change", null, n, r), e.push({
			event: n,
			listeners: t
		}));
	}
	var pr = null, mr = null;
	function hr(e) {
		xd(e, 0);
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
		}), zr && Ar(zr, r) || (zr = r, r = Od(Rr, "onSelect"), 0 < r.length && (t = new kn("onSelect", "select", null, t, n), e.push({
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
		if (50 < pu) throw pu = 0, mu = null, Error(s(185));
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
				X("cancel", t), X("close", t);
				break;
			case "iframe":
			case "object":
			case "embed":
				X("load", t);
				break;
			case "video":
			case "audio":
				for (n = 0; n < yd.length; n++) X(yd[n], t);
				break;
			case "source":
				X("error", t);
				break;
			case "img":
			case "image":
			case "link":
				X("error", t), X("load", t);
				break;
			case "details":
				X("toggle", t);
				break;
			case "input":
				X("invalid", t), Xt(t, r.value, r.defaultValue, r.checked, r.defaultChecked, r.type, r.name, !0);
				break;
			case "select":
				X("invalid", t);
				break;
			case "textarea": X("invalid", t), en(t, r.value, r.defaultValue, r.children);
		}
		n = r.children, typeof n != "string" && typeof n != "number" && typeof n != "bigint" || t.textContent === "" + n || !0 === r.suppressHydrationWarning || Pd(t.textContent, n) ? (r.popover != null && (X("beforetoggle", t), X("toggle", t)), r.onScroll != null && X("scroll", t), r.onScrollEnd != null && X("scrollend", t), r.onClick != null && (t.onclick = un), t = !0) : t = !1, t || Gi(e, !0);
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
		if ((n = t !== 3 && t !== 27) && ((n = t === 5) && (n = e.type, n = n === "form" || n === "button" || Wd(e.type, e.memoizedProps)), n = !n), n && Vi && Gi(e), qi(e), t === 13) {
			if (e = e.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(s(317));
			Vi = df(e);
		} else if (t === 31) {
			if (e = e.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(s(317));
			Vi = df(e);
		} else t === 27 ? (t = Vi, Qd(e.type) ? (e = uf, uf = null, Vi = e) : Vi = t) : Vi = Bi ? lf(e.stateNode.nextSibling) : null;
		return !0;
	}
	function Yi() {
		Vi = Bi = null, M = !1;
	}
	function Xi() {
		var e = Hi;
		return e !== null && ($l === null ? $l = e : $l.push.apply($l, e), Hi = null), e;
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
			va = 0, ya = pd(), ba = {
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
		nu = Fe(), typeof t == "object" && t && typeof t.then == "function" && xa(e, t), wa !== null && wa(e, t);
	};
	var Ta = pe(null);
	function Ea() {
		var e = Ta.current;
		return e === null ? G.pooledCache : e;
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
					if (e = G, e !== null && 100 < e.shellSuspendCounter) throw Error(s(482));
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
		if (r = r.shared, W & 2) {
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
				if (p ? (q & f) === f : (r & f) === f) {
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
			u === null && (c = d), i.baseState = c, i.firstBaseUpdate = l, i.lastBaseUpdate = u, a === null && (i.shared.lanes = 0), ql |= o, e.lanes = o, e.memoizedState = d;
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
		e = Gl, O(io, e), O(ro, t), Gl = e | t.baseLanes;
	}
	function oo() {
		O(io, Gl), O(ro, ro.current);
	}
	function so() {
		Gl = io.current, me(ro), me(io);
	}
	var co = pe(null), lo = null;
	function uo(e) {
		var t = e.alternate;
		O(ho, ho.current & 1), O(co, e), lo === null && (t === null || ro.current !== null || t.memoizedState !== null) && (lo = e);
	}
	function fo(e) {
		O(ho, ho.current), O(co, e), lo === null && (lo = e);
	}
	function F(e) {
		e.tag === 22 ? (O(ho, ho.current), O(co, e), lo === null && (lo = e)) : po(e);
	}
	function po() {
		O(ho, ho.current), O(co, co.current);
	}
	function mo(e) {
		me(co), lo === e && (lo = null), me(ho);
	}
	var ho = pe(0);
	function go(e) {
		for (var t = e; t !== null;) {
			if (t.tag === 13) {
				var n = t.memoizedState;
				if (n !== null && (n = n.dehydrated, n === null || of(n) || sf(n))) return t;
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
	var _o = 0, I = null, L = null, vo = null, yo = !1, bo = !1, xo = !1, So = 0, Co = 0, wo = null, To = 0;
	function Eo() {
		throw Error(s(321));
	}
	function Do(e, t) {
		if (t === null) return !1;
		for (var n = 0; n < t.length && n < e.length; n++) if (!kr(e[n], t[n])) return !1;
		return !0;
	}
	function Oo(e, t, n, r, i, a) {
		return _o = a, I = t, t.memoizedState = null, t.updateQueue = null, t.lanes = 0, E.H = e === null || e.memoizedState === null ? Hs : Us, xo = !1, a = n(r, i), xo = !1, bo && (a = Ao(t, n, r, i)), ko(e), a;
	}
	function ko(e) {
		E.H = Vs;
		var t = L !== null && L.next !== null;
		if (_o = 0, vo = L = I = null, yo = !1, Co = 0, wo = null, t) throw Error(s(300));
		e === null || oc || (e = e.dependencies, e !== null && oa(e) && (oc = !0));
	}
	function Ao(e, t, n, r) {
		I = e;
		var i = 0;
		do {
			if (bo && (wo = null), Co = 0, bo = !1, 25 <= i) throw Error(s(301));
			if (i += 1, vo = L = null, e.updateQueue != null) {
				var a = e.updateQueue;
				a.lastEffect = null, a.events = null, a.stores = null, a.memoCache != null && (a.memoCache.index = 0);
			}
			E.H = Ws, a = t(n, r);
		} while (bo);
		return a;
	}
	function jo() {
		var e = E.H, t = e.useState()[0];
		return t = typeof t.then == "function" ? Ro(t) : t, e = e.useState()[0], (L === null ? null : L.memoizedState) !== e && (I.flags |= 1024), t;
	}
	function Mo() {
		var e = So !== 0;
		return So = 0, e;
	}
	function No(e, t, n) {
		t.updateQueue = e.updateQueue, t.flags &= -2053, e.lanes &= ~n;
	}
	function Po(e) {
		if (yo) {
			for (e = e.memoizedState; e !== null;) {
				var t = e.queue;
				t !== null && (t.pending = null), e = e.next;
			}
			yo = !1;
		}
		_o = 0, vo = L = I = null, bo = !1, Co = So = 0, wo = null;
	}
	function Fo() {
		var e = {
			memoizedState: null,
			baseState: null,
			baseQueue: null,
			queue: null,
			next: null
		};
		return vo === null ? I.memoizedState = vo = e : vo = vo.next = e, vo;
	}
	function Io() {
		if (L === null) {
			var e = I.alternate;
			e = e === null ? null : e.memoizedState;
		} else e = L.next;
		var t = vo === null ? I.memoizedState : vo.next;
		if (t !== null) vo = t, L = e;
		else {
			if (e === null) throw I.alternate === null ? Error(s(467)) : Error(s(310));
			L = e, e = {
				memoizedState: L.memoizedState,
				baseState: L.baseState,
				baseQueue: L.baseQueue,
				queue: L.queue,
				next: null
			}, vo === null ? I.memoizedState = vo = e : vo = vo.next = e;
		}
		return vo;
	}
	function Lo() {
		return {
			lastEffect: null,
			events: null,
			stores: null,
			memoCache: null
		};
	}
	function Ro(e) {
		var t = Co;
		return Co += 1, wo === null && (wo = []), e = Na(wo, e, t), t = I, (vo === null ? t.memoizedState : vo.next) === null && (t = t.alternate, E.H = t === null || t.memoizedState === null ? Hs : Us), e;
	}
	function zo(e) {
		if (typeof e == "object" && e) {
			if (typeof e.then == "function") return Ro(e);
			if (e.$$typeof === C) return ca(e);
		}
		throw Error(s(438, String(e)));
	}
	function Bo(e) {
		var t = null, n = I.updateQueue;
		if (n !== null && (t = n.memoCache), t == null) {
			var r = I.alternate;
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
		}, n === null && (n = Lo(), I.updateQueue = n), n.memoCache = t, n = t.data[t.index], n === void 0) for (n = t.data[t.index] = Array(e), r = 0; r < e; r++) n[r] = ae;
		return t.index++, n;
	}
	function Vo(e, t) {
		return typeof t == "function" ? t(e) : t;
	}
	function R(e) {
		return Ho(Io(), L, e);
	}
	function Ho(e, t, n) {
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
				if (f === u.lane ? (_o & f) === f : (q & f) === f) {
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
					else if ((_o & p) === p) {
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
					}, l === null ? (c = l = f, o = a) : l = l.next = f, I.lanes |= p, ql |= p;
					f = u.action, xo && n(a, f), a = u.hasEagerState ? u.eagerState : n(a, f);
				} else p = {
					lane: f,
					revertLane: u.revertLane,
					gesture: u.gesture,
					action: u.action,
					hasEagerState: u.hasEagerState,
					eagerState: u.eagerState,
					next: null
				}, l === null ? (c = l = p, o = a) : l = l.next = p, I.lanes |= f, ql |= f;
				u = u.next;
			} while (u !== null && u !== t);
			if (l === null ? o = a : l.next = c, !kr(a, e.memoizedState) && (oc = !0, d && (n = ba, n !== null))) throw n;
			e.memoizedState = a, e.baseState = o, e.baseQueue = l, r.lastRenderedState = a;
		}
		return i === null && (r.lanes = 0), [e.memoizedState, r.dispatch];
	}
	function Uo(e) {
		var t = Io(), n = t.queue;
		if (n === null) throw Error(s(311));
		n.lastRenderedReducer = e;
		var r = n.dispatch, i = n.pending, a = t.memoizedState;
		if (i !== null) {
			n.pending = null;
			var o = i = i.next;
			do
				a = e(a, o.action), o = o.next;
			while (o !== i);
			kr(a, t.memoizedState) || (oc = !0), t.memoizedState = a, t.baseQueue === null && (t.baseState = a), n.lastRenderedState = a;
		}
		return [a, r];
	}
	function Wo(e, t, n) {
		var r = I, i = Io(), a = M;
		if (a) {
			if (n === void 0) throw Error(s(407));
			n = n();
		} else n = t();
		var o = !kr((L || i).memoizedState, n);
		if (o && (i.memoizedState = n, oc = !0), i = i.queue, ps(qo.bind(null, r, i, e), [e]), i.getSnapshot !== t || o || vo !== null && vo.memoizedState.tag & 1) {
			if (r.flags |= 2048, us(9, { destroy: void 0 }, Ko.bind(null, r, i, n, t), null), G === null) throw Error(s(349));
			a || _o & 127 || Go(r, t, n);
		}
		return n;
	}
	function Go(e, t, n) {
		e.flags |= 16384, e = {
			getSnapshot: t,
			value: n
		}, t = I.updateQueue, t === null ? (t = Lo(), I.updateQueue = t, t.stores = [e]) : (n = t.stores, n === null ? t.stores = [e] : n.push(e));
	}
	function Ko(e, t, n, r) {
		t.value = n, t.getSnapshot = r, Jo(t) && Yo(e);
	}
	function qo(e, t, n) {
		return n(function() {
			Jo(t) && Yo(e);
		});
	}
	function Jo(e) {
		var t = e.getSnapshot;
		e = e.value;
		try {
			var n = t();
			return !kr(e, n);
		} catch {
			return !0;
		}
	}
	function Yo(e) {
		var t = ui(e, 2);
		t !== null && _u(t, e, 2);
	}
	function Xo(e) {
		var t = Fo();
		if (typeof e == "function") {
			var n = e;
			if (e = n(), xo) {
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
			lastRenderedReducer: Vo,
			lastRenderedState: e
		}, t;
	}
	function Zo(e, t, n, r) {
		return e.baseState = n, Ho(e, L, typeof r == "function" ? r : Vo);
	}
	function Qo(e, t, n, r, i) {
		if (Rs(e)) throw Error(s(485));
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
			E.T === null ? a.isTransition = !1 : n(!0), r(a), n = t.pending, n === null ? (a.next = t.pending = a, $o(t, a)) : (a.next = n.next, t.pending = n.next = a);
		}
	}
	function $o(e, t) {
		var n = t.action, r = t.payload, i = e.state;
		if (t.isTransition) {
			var a = E.T, o = {};
			E.T = o;
			try {
				var s = n(i, r), c = E.S;
				c !== null && c(o, s), es(e, t, s);
			} catch (n) {
				ns(e, t, n);
			} finally {
				a !== null && o.types !== null && (a.types = o.types), E.T = a;
			}
		} else try {
			a = n(i, r), es(e, t, a);
		} catch (n) {
			ns(e, t, n);
		}
	}
	function es(e, t, n) {
		typeof n == "object" && n && typeof n.then == "function" ? n.then(function(n) {
			ts(e, t, n);
		}, function(n) {
			return ns(e, t, n);
		}) : ts(e, t, n);
	}
	function ts(e, t, n) {
		t.status = "fulfilled", t.value = n, rs(t), e.state = n, t = e.pending, t !== null && (n = t.next, n === t ? e.pending = null : (n = n.next, t.next = n, $o(e, n)));
	}
	function ns(e, t, n) {
		var r = e.pending;
		if (e.pending = null, r !== null) {
			r = r.next;
			do
				t.status = "rejected", t.reason = n, rs(t), t = t.next;
			while (t !== r);
		}
		e.action = null;
	}
	function rs(e) {
		e = e.listeners;
		for (var t = 0; t < e.length; t++) (0, e[t])();
	}
	function is(e, t) {
		return t;
	}
	function as(e, t) {
		if (M) {
			var n = G.formState;
			if (n !== null) {
				a: {
					var r = I;
					if (M) {
						if (Vi) {
							b: {
								for (var i = Vi, a = Ui; i.nodeType !== 8;) {
									if (!a) {
										i = null;
										break b;
									}
									if (i = lf(i.nextSibling), i === null) {
										i = null;
										break b;
									}
								}
								a = i.data, i = a === "F!" || a === "F" ? i : null;
							}
							if (i) {
								Vi = lf(i.nextSibling), r = i.data === "F!";
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
		return n = Fo(), n.memoizedState = n.baseState = t, r = {
			pending: null,
			lanes: 0,
			dispatch: null,
			lastRenderedReducer: is,
			lastRenderedState: t
		}, n.queue = r, n = Fs.bind(null, I, r), r.dispatch = n, r = Xo(!1), a = Ls.bind(null, I, !1, r.queue), r = Fo(), i = {
			state: t,
			dispatch: null,
			action: e,
			pending: null
		}, r.queue = i, n = Qo.bind(null, I, i, a, n), i.dispatch = n, r.memoizedState = e, [
			t,
			n,
			!1
		];
	}
	function os(e) {
		return ss(Io(), L, e);
	}
	function ss(e, t, n) {
		if (t = Ho(e, t, is)[0], e = R(Vo)[0], typeof t == "object" && t && typeof t.then == "function") try {
			var r = Ro(t);
		} catch (e) {
			throw e === Oa ? Aa : e;
		}
		else r = t;
		t = Io();
		var i = t.queue, a = i.dispatch;
		return n !== t.memoizedState && (I.flags |= 2048, us(9, { destroy: void 0 }, cs.bind(null, i, n), null)), [
			r,
			a,
			e
		];
	}
	function cs(e, t) {
		e.action = t;
	}
	function ls(e) {
		var t = Io(), n = L;
		if (n !== null) return ss(t, n, e);
		Io(), t = t.memoizedState, n = Io();
		var r = n.queue.dispatch;
		return n.memoizedState = e, [
			t,
			r,
			!1
		];
	}
	function us(e, t, n, r) {
		return e = {
			tag: e,
			create: n,
			deps: r,
			inst: t,
			next: null
		}, t = I.updateQueue, t === null && (t = Lo(), I.updateQueue = t), n = t.lastEffect, n === null ? t.lastEffect = e.next = e : (r = n.next, n.next = e, e.next = r, t.lastEffect = e), e;
	}
	function z() {
		return Io().memoizedState;
	}
	function ds(e, t, n, r) {
		var i = Fo();
		I.flags |= e, i.memoizedState = us(1 | t, { destroy: void 0 }, n, r === void 0 ? null : r);
	}
	function fs(e, t, n, r) {
		var i = Io();
		r = r === void 0 ? null : r;
		var a = i.memoizedState.inst;
		L !== null && r !== null && Do(r, L.memoizedState.deps) ? i.memoizedState = us(t, a, n, r) : (I.flags |= e, i.memoizedState = us(1 | t, a, n, r));
	}
	function B(e, t) {
		ds(8390656, 8, e, t);
	}
	function ps(e, t) {
		fs(2048, 8, e, t);
	}
	function ms(e) {
		I.flags |= 4;
		var t = I.updateQueue;
		if (t === null) t = Lo(), I.updateQueue = t, t.events = [e];
		else {
			var n = t.events;
			n === null ? t.events = [e] : n.push(e);
		}
	}
	function hs(e) {
		var t = Io().memoizedState;
		return ms({
			ref: t,
			nextImpl: e
		}), function() {
			if (W & 2) throw Error(s(440));
			return t.impl.apply(void 0, arguments);
		};
	}
	function gs(e, t) {
		return fs(4, 2, e, t);
	}
	function _s(e, t) {
		return fs(4, 4, e, t);
	}
	function vs(e, t) {
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
	function ys(e, t, n) {
		n = n == null ? null : n.concat([e]), fs(4, 4, vs.bind(null, t, e), n);
	}
	function bs() {}
	function xs(e, t) {
		var n = Io();
		t = t === void 0 ? null : t;
		var r = n.memoizedState;
		return t !== null && Do(t, r[1]) ? r[0] : (n.memoizedState = [e, t], e);
	}
	function Ss(e, t) {
		var n = Io();
		t = t === void 0 ? null : t;
		var r = n.memoizedState;
		if (t !== null && Do(t, r[1])) return r[0];
		if (r = e(), xo) {
			Ke(!0);
			try {
				e();
			} finally {
				Ke(!1);
			}
		}
		return n.memoizedState = [r, t], r;
	}
	function Cs(e, t, n) {
		return n === void 0 || _o & 1073741824 && !(q & 261930) ? e.memoizedState = t : (e.memoizedState = n, e = gu(), I.lanes |= e, ql |= e, n);
	}
	function ws(e, t, n, r) {
		return kr(n, t) ? n : ro.current === null ? !(_o & 42) || _o & 1073741824 && !(q & 261930) ? (oc = !0, e.memoizedState = n) : (e = gu(), I.lanes |= e, ql |= e, t) : (e = Cs(e, n, r), kr(e, t) || (oc = !0), e);
	}
	function Ts(e, t, n, r, i) {
		var a = D.p;
		D.p = a !== 0 && 8 > a ? a : 8;
		var o = E.T, s = {};
		E.T = s, Ls(e, !1, t, n);
		try {
			var c = i(), l = E.S;
			l !== null && l(s, c), typeof c == "object" && c && typeof c.then == "function" ? Is(e, t, Ca(c, r), hu(e)) : Is(e, t, r, hu(e));
		} catch (n) {
			Is(e, t, {
				then: function() {},
				status: "rejected",
				reason: n
			}, hu());
		} finally {
			D.p = a, o !== null && s.types !== null && (o.types = s.types), E.T = o;
		}
	}
	function Es() {}
	function Ds(e, t, n, r) {
		if (e.tag !== 5) throw Error(s(476));
		var i = Os(e).queue;
		Ts(e, i, t, ue, n === null ? Es : function() {
			return ks(e), n(r);
		});
	}
	function Os(e) {
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
				lastRenderedReducer: Vo,
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
				lastRenderedReducer: Vo,
				lastRenderedState: n
			},
			next: null
		}, e.memoizedState = t, e = e.alternate, e !== null && (e.memoizedState = t), t;
	}
	function ks(e) {
		var t = Os(e);
		t.next === null && (t = e.alternate.memoizedState), Is(e, t.next.queue, {}, hu());
	}
	function As() {
		return ca(Qf);
	}
	function js() {
		return Io().memoizedState;
	}
	function Ms() {
		return Io().memoizedState;
	}
	function Ns(e) {
		for (var t = e.return; t !== null;) {
			switch (t.tag) {
				case 24:
				case 3:
					var n = hu();
					e = Ja(n);
					var r = Ya(t, e, n);
					r !== null && (_u(r, t, n), Xa(r, t, n)), t = { cache: ha() }, e.payload = t;
					return;
			}
			t = t.return;
		}
	}
	function Ps(e, t, n) {
		var r = hu();
		n = {
			lane: r,
			revertLane: 0,
			gesture: null,
			action: n,
			hasEagerState: !1,
			eagerState: null,
			next: null
		}, Rs(e) ? zs(t, n) : (n = li(e, t, n, r), n !== null && (_u(n, e, r), Bs(n, t, r)));
	}
	function Fs(e, t, n) {
		Is(e, t, n, hu());
	}
	function Is(e, t, n, r) {
		var i = {
			lane: r,
			revertLane: 0,
			gesture: null,
			action: n,
			hasEagerState: !1,
			eagerState: null,
			next: null
		};
		if (Rs(e)) zs(t, i);
		else {
			var a = e.alternate;
			if (e.lanes === 0 && (a === null || a.lanes === 0) && (a = t.lastRenderedReducer, a !== null)) try {
				var o = t.lastRenderedState, s = a(o, n);
				if (i.hasEagerState = !0, i.eagerState = s, kr(s, o)) return ci(e, t, i, 0), G === null && si(), !1;
			} catch {}
			if (n = li(e, t, i, r), n !== null) return _u(n, e, r), Bs(n, t, r), !0;
		}
		return !1;
	}
	function Ls(e, t, n, r) {
		if (r = {
			lane: 2,
			revertLane: pd(),
			gesture: null,
			action: r,
			hasEagerState: !1,
			eagerState: null,
			next: null
		}, Rs(e)) {
			if (t) throw Error(s(479));
		} else t = li(e, n, r, 2), t !== null && _u(t, e, 2);
	}
	function Rs(e) {
		var t = e.alternate;
		return e === I || t !== null && t === I;
	}
	function zs(e, t) {
		bo = yo = !0;
		var n = e.pending;
		n === null ? t.next = t : (t.next = n.next, n.next = t), e.pending = t;
	}
	function Bs(e, t, n) {
		if (n & 4194048) {
			var r = t.lanes;
			r &= e.pendingLanes, n |= r, t.lanes = n, lt(e, n);
		}
	}
	var Vs = {
		readContext: ca,
		use: zo,
		useCallback: Eo,
		useContext: Eo,
		useEffect: Eo,
		useImperativeHandle: Eo,
		useLayoutEffect: Eo,
		useInsertionEffect: Eo,
		useMemo: Eo,
		useReducer: Eo,
		useRef: Eo,
		useState: Eo,
		useDebugValue: Eo,
		useDeferredValue: Eo,
		useTransition: Eo,
		useSyncExternalStore: Eo,
		useId: Eo,
		useHostTransitionStatus: Eo,
		useFormState: Eo,
		useActionState: Eo,
		useOptimistic: Eo,
		useMemoCache: Eo,
		useCacheRefresh: Eo
	};
	Vs.useEffectEvent = Eo;
	var Hs = {
		readContext: ca,
		use: zo,
		useCallback: function(e, t) {
			return Fo().memoizedState = [e, t === void 0 ? null : t], e;
		},
		useContext: ca,
		useEffect: B,
		useImperativeHandle: function(e, t, n) {
			n = n == null ? null : n.concat([e]), ds(4194308, 4, vs.bind(null, t, e), n);
		},
		useLayoutEffect: function(e, t) {
			return ds(4194308, 4, e, t);
		},
		useInsertionEffect: function(e, t) {
			ds(4, 2, e, t);
		},
		useMemo: function(e, t) {
			var n = Fo();
			t = t === void 0 ? null : t;
			var r = e();
			if (xo) {
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
			var r = Fo();
			if (n !== void 0) {
				var i = n(t);
				if (xo) {
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
			}, r.queue = e, e = e.dispatch = Ps.bind(null, I, e), [r.memoizedState, e];
		},
		useRef: function(e) {
			var t = Fo();
			return e = { current: e }, t.memoizedState = e;
		},
		useState: function(e) {
			e = Xo(e);
			var t = e.queue, n = Fs.bind(null, I, t);
			return t.dispatch = n, [e.memoizedState, n];
		},
		useDebugValue: bs,
		useDeferredValue: function(e, t) {
			return Cs(Fo(), e, t);
		},
		useTransition: function() {
			var e = Xo(!1);
			return e = Ts.bind(null, I, e.queue, !0, !1), Fo().memoizedState = e, [!1, e];
		},
		useSyncExternalStore: function(e, t, n) {
			var r = I, i = Fo();
			if (M) {
				if (n === void 0) throw Error(s(407));
				n = n();
			} else {
				if (n = t(), G === null) throw Error(s(349));
				q & 127 || Go(r, t, n);
			}
			i.memoizedState = n;
			var a = {
				value: n,
				getSnapshot: t
			};
			return i.queue = a, B(qo.bind(null, r, a, e), [e]), r.flags |= 2048, us(9, { destroy: void 0 }, Ko.bind(null, r, a, n, t), null), n;
		},
		useId: function() {
			var e = Fo(), t = G.identifierPrefix;
			if (M) {
				var n = Pi, r = Ni;
				n = (r & ~(1 << 32 - qe(r) - 1)).toString(32) + n, t = "_" + t + "R_" + n, n = So++, 0 < n && (t += "H" + n.toString(32)), t += "_";
			} else n = To++, t = "_" + t + "r_" + n.toString(32) + "_";
			return e.memoizedState = t;
		},
		useHostTransitionStatus: As,
		useFormState: as,
		useActionState: as,
		useOptimistic: function(e) {
			var t = Fo();
			t.memoizedState = t.baseState = e;
			var n = {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: null,
				lastRenderedState: null
			};
			return t.queue = n, t = Ls.bind(null, I, !0, n), n.dispatch = t, [e, t];
		},
		useMemoCache: Bo,
		useCacheRefresh: function() {
			return Fo().memoizedState = Ns.bind(null, I);
		},
		useEffectEvent: function(e) {
			var t = Fo(), n = { impl: e };
			return t.memoizedState = n, function() {
				if (W & 2) throw Error(s(440));
				return n.impl.apply(void 0, arguments);
			};
		}
	}, Us = {
		readContext: ca,
		use: zo,
		useCallback: xs,
		useContext: ca,
		useEffect: ps,
		useImperativeHandle: ys,
		useInsertionEffect: gs,
		useLayoutEffect: _s,
		useMemo: Ss,
		useReducer: R,
		useRef: z,
		useState: function() {
			return R(Vo);
		},
		useDebugValue: bs,
		useDeferredValue: function(e, t) {
			return ws(Io(), L.memoizedState, e, t);
		},
		useTransition: function() {
			var e = R(Vo)[0], t = Io().memoizedState;
			return [typeof e == "boolean" ? e : Ro(e), t];
		},
		useSyncExternalStore: Wo,
		useId: js,
		useHostTransitionStatus: As,
		useFormState: os,
		useActionState: os,
		useOptimistic: function(e, t) {
			return Zo(Io(), L, e, t);
		},
		useMemoCache: Bo,
		useCacheRefresh: Ms
	};
	Us.useEffectEvent = hs;
	var Ws = {
		readContext: ca,
		use: zo,
		useCallback: xs,
		useContext: ca,
		useEffect: ps,
		useImperativeHandle: ys,
		useInsertionEffect: gs,
		useLayoutEffect: _s,
		useMemo: Ss,
		useReducer: Uo,
		useRef: z,
		useState: function() {
			return Uo(Vo);
		},
		useDebugValue: bs,
		useDeferredValue: function(e, t) {
			var n = Io();
			return L === null ? Cs(n, e, t) : ws(n, L.memoizedState, e, t);
		},
		useTransition: function() {
			var e = Uo(Vo)[0], t = Io().memoizedState;
			return [typeof e == "boolean" ? e : Ro(e), t];
		},
		useSyncExternalStore: Wo,
		useId: js,
		useHostTransitionStatus: As,
		useFormState: ls,
		useActionState: ls,
		useOptimistic: function(e, t) {
			var n = Io();
			return L === null ? (n.baseState = e, [e, n.queue.dispatch]) : Zo(n, L, e, t);
		},
		useMemoCache: Bo,
		useCacheRefresh: Ms
	};
	Ws.useEffectEvent = hs;
	function Gs(e, t, n, r) {
		t = e.memoizedState, n = n(r, t), n = n == null ? t : h({}, t, n), e.memoizedState = n, e.lanes === 0 && (e.updateQueue.baseState = n);
	}
	var Ks = {
		enqueueSetState: function(e, t, n) {
			e = e._reactInternals;
			var r = hu(), i = Ja(r);
			i.payload = t, n != null && (i.callback = n), t = Ya(e, i, r), t !== null && (_u(t, e, r), Xa(t, e, r));
		},
		enqueueReplaceState: function(e, t, n) {
			e = e._reactInternals;
			var r = hu(), i = Ja(r);
			i.tag = 1, i.payload = t, n != null && (i.callback = n), t = Ya(e, i, r), t !== null && (_u(t, e, r), Xa(t, e, r));
		},
		enqueueForceUpdate: function(e, t) {
			e = e._reactInternals;
			var n = hu(), r = Ja(n);
			r.tag = 2, t != null && (r.callback = t), t = Ya(e, r, n), t !== null && (_u(t, e, n), Xa(t, e, n));
		}
	};
	function qs(e, t, n, r, i, a, o) {
		return e = e.stateNode, typeof e.shouldComponentUpdate == "function" ? e.shouldComponentUpdate(r, a, o) : t.prototype && t.prototype.isPureReactComponent ? !Ar(n, r) || !Ar(i, a) : !0;
	}
	function Js(e, t, n, r) {
		e = t.state, typeof t.componentWillReceiveProps == "function" && t.componentWillReceiveProps(n, r), typeof t.UNSAFE_componentWillReceiveProps == "function" && t.UNSAFE_componentWillReceiveProps(n, r), t.state !== e && Ks.enqueueReplaceState(t, t.state, null);
	}
	function Ys(e, t) {
		var n = t;
		if ("ref" in t) for (var r in n = {}, t) r !== "ref" && (n[r] = t[r]);
		if (e = e.defaultProps) for (var i in n === t && (n = h({}, n)), e) n[i] === void 0 && (n[i] = e[i]);
		return n;
	}
	function Xs(e) {
		ri(e);
	}
	function Zs(e) {
		console.error(e);
	}
	function Qs(e) {
		ri(e);
	}
	function $s(e, t) {
		try {
			var n = e.onUncaughtError;
			n(t.value, { componentStack: t.stack });
		} catch (e) {
			setTimeout(function() {
				throw e;
			});
		}
	}
	function ec(e, t, n) {
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
	function tc(e, t, n) {
		return n = Ja(n), n.tag = 3, n.payload = { element: null }, n.callback = function() {
			$s(e, t);
		}, n;
	}
	function nc(e) {
		return e = Ja(e), e.tag = 3, e;
	}
	function rc(e, t, n, r) {
		var i = n.type.getDerivedStateFromError;
		if (typeof i == "function") {
			var a = r.value;
			e.payload = function() {
				return i(a);
			}, e.callback = function() {
				ec(t, n, r);
			};
		}
		var o = n.stateNode;
		o !== null && typeof o.componentDidCatch == "function" && (e.callback = function() {
			ec(t, n, r), typeof i != "function" && (au === null ? au = /* @__PURE__ */ new Set([this]) : au.add(this));
			var e = r.stack;
			this.componentDidCatch(r.value, { componentStack: e === null ? "" : e });
		});
	}
	function ic(e, t, n, r, i) {
		if (n.flags |= 32768, typeof r == "object" && r && typeof r.then == "function") {
			if (t = n.alternate, t !== null && aa(t, n, i, !0), n = co.current, n !== null) {
				switch (n.tag) {
					case 31:
					case 13: return lo === null ? ku() : n.alternate === null && Kl === 0 && (Kl = 3), n.flags &= -257, n.flags |= 65536, n.lanes = i, r === ja ? n.flags |= 16384 : (t = n.updateQueue, t === null ? n.updateQueue = /* @__PURE__ */ new Set([r]) : t.add(r), qu(e, r, i)), !1;
					case 22: return n.flags |= 65536, r === ja ? n.flags |= 16384 : (t = n.updateQueue, t === null ? (t = {
						transitions: null,
						markerInstances: null,
						retryQueue: /* @__PURE__ */ new Set([r])
					}, n.updateQueue = t) : (n = t.retryQueue, n === null ? t.retryQueue = /* @__PURE__ */ new Set([r]) : n.add(r)), qu(e, r, i)), !1;
				}
				throw Error(s(435, n.tag));
			}
			return qu(e, r, i), ku(), !1;
		}
		if (M) return t = co.current, t === null ? (r !== Wi && (t = Error(s(423), { cause: r }), Zi(Ti(t, n))), e = e.current.alternate, e.flags |= 65536, i &= -i, e.lanes |= i, r = Ti(r, n), i = tc(e.stateNode, r, i), Za(e, i), Kl !== 4 && (Kl = 2)) : (!(t.flags & 65536) && (t.flags |= 256), t.flags |= 65536, t.lanes = i, r !== Wi && (e = Error(s(422), { cause: r }), Zi(Ti(e, n)))), !1;
		var a = Error(s(520), { cause: r });
		if (a = Ti(a, n), Ql === null ? Ql = [a] : Ql.push(a), Kl !== 4 && (Kl = 2), t === null) return !0;
		r = Ti(r, n), n = t;
		do {
			switch (n.tag) {
				case 3: return n.flags |= 65536, e = i & -i, n.lanes |= e, e = tc(n.stateNode, r, e), Za(n, e), !1;
				case 1: if (t = n.type, a = n.stateNode, !(n.flags & 128) && (typeof t.getDerivedStateFromError == "function" || a !== null && typeof a.componentDidCatch == "function" && (au === null || !au.has(a)))) return n.flags |= 65536, i &= -i, n.lanes |= i, i = nc(i), rc(i, e, n, r), Za(n, i), !1;
			}
			n = n.return;
		} while (n !== null);
		return !1;
	}
	var ac = Error(s(461)), oc = !1;
	function sc(e, t, n, r) {
		t.child = e === null ? Wa(t, null, n, r) : Ua(t, e.child, n, r);
	}
	function cc(e, t, n, r, i) {
		n = n.render;
		var a = t.ref;
		if ("ref" in r) {
			var o = {};
			for (var s in r) s !== "ref" && (o[s] = r[s]);
		} else o = r;
		return sa(t), r = Oo(e, t, n, o, a, i), s = Mo(), e !== null && !oc ? (No(e, t, i), jc(e, t, i)) : (M && s && Li(t), t.flags |= 1, sc(e, t, r, i), t.child);
	}
	function lc(e, t, n, r, i) {
		if (e === null) {
			var a = n.type;
			return typeof a == "function" && !gi(a) && a.defaultProps === void 0 && n.compare === null ? (t.tag = 15, t.type = a, uc(e, t, a, r, i)) : (e = yi(n.type, null, r, t, t.mode, i), e.ref = t.ref, e.return = t, t.child = e);
		}
		if (a = e.child, !Mc(e, i)) {
			var o = a.memoizedProps;
			if (n = n.compare, n = n === null ? Ar : n, n(o, r) && e.ref === t.ref) return jc(e, t, i);
		}
		return t.flags |= 1, e = _i(a, r), e.ref = t.ref, e.return = t, t.child = e;
	}
	function uc(e, t, n, r, i) {
		if (e !== null) {
			var a = e.memoizedProps;
			if (Ar(a, r) && e.ref === t.ref) {
				if (oc = !1, t.pendingProps = r = a, Mc(e, i)) e.flags & 131072 && (oc = !0);
				else return t.lanes = e.lanes, jc(e, t, i);
			}
		}
		return vc(e, t, n, r, i);
	}
	function dc(e, t, n, r) {
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
				return pc(e, t, a, n, r);
			}
			if (n & 536870912) t.memoizedState = {
				baseLanes: 0,
				cachePool: null
			}, e !== null && Da(t, a === null ? null : a.cachePool), a === null ? oo() : ao(t, a), F(t);
			else return r = t.lanes = 536870912, pc(e, t, a === null ? n : a.baseLanes | n, n, r);
		} else a === null ? (e !== null && Da(t, null), oo(), po(t)) : (Da(t, a.cachePool), ao(t, a), po(t), t.memoizedState = null);
		return sc(e, t, i, n), t.child;
	}
	function fc(e, t) {
		return e !== null && e.tag === 22 || t.stateNode !== null || (t.stateNode = {
			_visibility: 1,
			_pendingMarkers: null,
			_retryCache: null,
			_transitions: null
		}), t.sibling;
	}
	function pc(e, t, n, r, i) {
		var a = Ea();
		return a = a === null ? null : {
			parent: ma._currentValue,
			pool: a
		}, t.memoizedState = {
			baseLanes: n,
			cachePool: a
		}, e !== null && Da(t, null), oo(), F(t), e !== null && aa(e, t, r, !0), t.childLanes = i, null;
	}
	function mc(e, t) {
		return t = V({
			mode: t.mode,
			children: t.children
		}, e.mode), t.ref = e.ref, e.child = t, t.return = e, t;
	}
	function hc(e, t, n) {
		return Ua(t, e.child, null, n), e = mc(t, t.pendingProps), e.flags |= 2, mo(t), t.memoizedState = null, e;
	}
	function gc(e, t, n) {
		var r = t.pendingProps, i = !!(t.flags & 128);
		if (t.flags &= -129, e === null) {
			if (M) {
				if (r.mode === "hidden") return e = mc(t, r), t.lanes = 536870912, fc(null, e);
				if (fo(t), (e = Vi) ? (e = af(e, Ui), e = e !== null && e.data === "&" ? e : null, e !== null && (t.memoizedState = {
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
			return mc(t, r);
		}
		var a = e.memoizedState;
		if (a !== null) {
			var o = a.dehydrated;
			if (fo(t), i) {
				if (t.flags & 256) t.flags &= -257, t = hc(e, t, n);
				else if (t.memoizedState !== null) t.child = e.child, t.flags |= 128, t = null;
				else throw Error(s(558));
			} else if (oc || aa(e, t, n, !1), i = (n & e.childLanes) !== 0, oc || i) {
				if (r = G, r !== null && (o = ut(r, n), o !== 0 && o !== a.retryLane)) throw a.retryLane = o, ui(e, o), _u(r, e, o), ac;
				ku(), t = hc(e, t, n);
			} else e = a.treeContext, Vi = lf(o.nextSibling), Bi = t, M = !0, Hi = null, Ui = !1, e !== null && zi(t, e), t = mc(t, r), t.flags |= 4096;
			return t;
		}
		return e = _i(e.child, {
			mode: r.mode,
			children: r.children
		}), e.ref = t.ref, t.child = e, e.return = t, e;
	}
	function _c(e, t) {
		var n = t.ref;
		if (n === null) e !== null && e.ref !== null && (t.flags |= 4194816);
		else {
			if (typeof n != "function" && typeof n != "object") throw Error(s(284));
			(e === null || e.ref !== n) && (t.flags |= 4194816);
		}
	}
	function vc(e, t, n, r, i) {
		return sa(t), n = Oo(e, t, n, r, void 0, i), r = Mo(), e !== null && !oc ? (No(e, t, i), jc(e, t, i)) : (M && r && Li(t), t.flags |= 1, sc(e, t, n, i), t.child);
	}
	function yc(e, t, n, r, i, a) {
		return sa(t), t.updateQueue = null, n = Ao(t, r, n, i), ko(e), r = Mo(), e !== null && !oc ? (No(e, t, a), jc(e, t, a)) : (M && r && Li(t), t.flags |= 1, sc(e, t, n, a), t.child);
	}
	function bc(e, t, n, r, i) {
		if (sa(t), t.stateNode === null) {
			var a = pi, o = n.contextType;
			typeof o == "object" && o && (a = ca(o)), a = new n(r, a), t.memoizedState = a.state !== null && a.state !== void 0 ? a.state : null, a.updater = Ks, t.stateNode = a, a._reactInternals = t, a = t.stateNode, a.props = r, a.state = t.memoizedState, a.refs = {}, Ka(t), o = n.contextType, a.context = typeof o == "object" && o ? ca(o) : pi, a.state = t.memoizedState, o = n.getDerivedStateFromProps, typeof o == "function" && (Gs(t, n, o, r), a.state = t.memoizedState), typeof n.getDerivedStateFromProps == "function" || typeof a.getSnapshotBeforeUpdate == "function" || typeof a.UNSAFE_componentWillMount != "function" && typeof a.componentWillMount != "function" || (o = a.state, typeof a.componentWillMount == "function" && a.componentWillMount(), typeof a.UNSAFE_componentWillMount == "function" && a.UNSAFE_componentWillMount(), o !== a.state && Ks.enqueueReplaceState(a, a.state, null), eo(t, r, a, i), $a(), a.state = t.memoizedState), typeof a.componentDidMount == "function" && (t.flags |= 4194308), r = !0;
		} else if (e === null) {
			a = t.stateNode;
			var s = t.memoizedProps, c = Ys(n, s);
			a.props = c;
			var l = a.context, u = n.contextType;
			o = pi, typeof u == "object" && u && (o = ca(u));
			var d = n.getDerivedStateFromProps;
			u = typeof d == "function" || typeof a.getSnapshotBeforeUpdate == "function", s = t.pendingProps !== s, u || typeof a.UNSAFE_componentWillReceiveProps != "function" && typeof a.componentWillReceiveProps != "function" || (s || l !== o) && Js(t, a, r, o), Ga = !1;
			var f = t.memoizedState;
			a.state = f, eo(t, r, a, i), $a(), l = t.memoizedState, s || f !== l || Ga ? (typeof d == "function" && (Gs(t, n, d, r), l = t.memoizedState), (c = Ga || qs(t, n, c, r, f, l, o)) ? (u || typeof a.UNSAFE_componentWillMount != "function" && typeof a.componentWillMount != "function" || (typeof a.componentWillMount == "function" && a.componentWillMount(), typeof a.UNSAFE_componentWillMount == "function" && a.UNSAFE_componentWillMount()), typeof a.componentDidMount == "function" && (t.flags |= 4194308)) : (typeof a.componentDidMount == "function" && (t.flags |= 4194308), t.memoizedProps = r, t.memoizedState = l), a.props = r, a.state = l, a.context = o, r = c) : (typeof a.componentDidMount == "function" && (t.flags |= 4194308), r = !1);
		} else {
			a = t.stateNode, qa(e, t), o = t.memoizedProps, u = Ys(n, o), a.props = u, d = t.pendingProps, f = a.context, l = n.contextType, c = pi, typeof l == "object" && l && (c = ca(l)), s = n.getDerivedStateFromProps, (l = typeof s == "function" || typeof a.getSnapshotBeforeUpdate == "function") || typeof a.UNSAFE_componentWillReceiveProps != "function" && typeof a.componentWillReceiveProps != "function" || (o !== d || f !== c) && Js(t, a, r, c), Ga = !1, f = t.memoizedState, a.state = f, eo(t, r, a, i), $a();
			var p = t.memoizedState;
			o !== d || f !== p || Ga || e !== null && e.dependencies !== null && oa(e.dependencies) ? (typeof s == "function" && (Gs(t, n, s, r), p = t.memoizedState), (u = Ga || qs(t, n, u, r, f, p, c) || e !== null && e.dependencies !== null && oa(e.dependencies)) ? (l || typeof a.UNSAFE_componentWillUpdate != "function" && typeof a.componentWillUpdate != "function" || (typeof a.componentWillUpdate == "function" && a.componentWillUpdate(r, p, c), typeof a.UNSAFE_componentWillUpdate == "function" && a.UNSAFE_componentWillUpdate(r, p, c)), typeof a.componentDidUpdate == "function" && (t.flags |= 4), typeof a.getSnapshotBeforeUpdate == "function" && (t.flags |= 1024)) : (typeof a.componentDidUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 4), typeof a.getSnapshotBeforeUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 1024), t.memoizedProps = r, t.memoizedState = p), a.props = r, a.state = p, a.context = c, r = u) : (typeof a.componentDidUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 4), typeof a.getSnapshotBeforeUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 1024), r = !1);
		}
		return a = r, _c(e, t), r = !!(t.flags & 128), a || r ? (a = t.stateNode, n = r && typeof n.getDerivedStateFromError != "function" ? null : a.render(), t.flags |= 1, e !== null && r ? (t.child = Ua(t, e.child, null, i), t.child = Ua(t, null, n, i)) : sc(e, t, n, i), t.memoizedState = a.state, e = t.child) : e = jc(e, t, i), e;
	}
	function xc(e, t, n, r) {
		return Yi(), t.flags |= 256, sc(e, t, n, r), t.child;
	}
	var Sc = {
		dehydrated: null,
		treeContext: null,
		retryLane: 0,
		hydrationErrors: null
	};
	function Cc(e) {
		return {
			baseLanes: e,
			cachePool: N()
		};
	}
	function wc(e, t, n) {
		return e = e === null ? 0 : e.childLanes & ~n, t && (e |= Xl), e;
	}
	function Tc(e, t, n) {
		var r = t.pendingProps, i = !1, a = !!(t.flags & 128), o;
		if ((o = a) || (o = e !== null && e.memoizedState === null ? !1 : !!(ho.current & 2)), o && (i = !0, t.flags &= -129), o = !!(t.flags & 32), t.flags &= -33, e === null) {
			if (M) {
				if (i ? uo(t) : po(t), (e = Vi) ? (e = af(e, Ui), e = e !== null && e.data !== "&" ? e : null, e !== null && (t.memoizedState = {
					dehydrated: e,
					treeContext: Mi === null ? null : {
						id: Ni,
						overflow: Pi
					},
					retryLane: 536870912,
					hydrationErrors: null
				}, n = Si(e), n.return = t, t.child = n, Bi = t, Vi = null)) : e = null, e === null) throw Gi(t);
				return sf(e) ? t.lanes = 32 : t.lanes = 536870912, null;
			}
			var c = r.children;
			return r = r.fallback, i ? (po(t), i = t.mode, c = V({
				mode: "hidden",
				children: c
			}, i), r = bi(r, i, n, null), c.return = t, r.return = t, c.sibling = r, t.child = c, r = t.child, r.memoizedState = Cc(n), r.childLanes = wc(e, o, n), t.memoizedState = Sc, fc(null, r)) : (uo(t), Ec(t, c));
		}
		var l = e.memoizedState;
		if (l !== null && (c = l.dehydrated, c !== null)) {
			if (a) t.flags & 256 ? (uo(t), t.flags &= -257, t = Dc(e, t, n)) : t.memoizedState === null ? (po(t), c = r.fallback, i = t.mode, r = V({
				mode: "visible",
				children: r.children
			}, i), c = bi(c, i, n, null), c.flags |= 2, r.return = t, c.return = t, r.sibling = c, t.child = r, Ua(t, e.child, null, n), r = t.child, r.memoizedState = Cc(n), r.childLanes = wc(e, o, n), t.memoizedState = Sc, t = fc(null, r)) : (po(t), t.child = e.child, t.flags |= 128, t = null);
			else if (uo(t), sf(c)) {
				if (o = c.nextSibling && c.nextSibling.dataset, o) var u = o.dgst;
				o = u, r = Error(s(419)), r.stack = "", r.digest = o, Zi({
					value: r,
					source: null,
					stack: null
				}), t = Dc(e, t, n);
			} else if (oc || aa(e, t, n, !1), o = (n & e.childLanes) !== 0, oc || o) {
				if (o = G, o !== null && (r = ut(o, n), r !== 0 && r !== l.retryLane)) throw l.retryLane = r, ui(e, r), _u(o, e, r), ac;
				of(c) || ku(), t = Dc(e, t, n);
			} else of(c) ? (t.flags |= 192, t.child = e.child, t = null) : (e = l.treeContext, Vi = lf(c.nextSibling), Bi = t, M = !0, Hi = null, Ui = !1, e !== null && zi(t, e), t = Ec(t, r.children), t.flags |= 4096);
			return t;
		}
		return i ? (po(t), c = r.fallback, i = t.mode, l = e.child, u = l.sibling, r = _i(l, {
			mode: "hidden",
			children: r.children
		}), r.subtreeFlags = l.subtreeFlags & 65011712, u === null ? (c = bi(c, i, n, null), c.flags |= 2) : c = _i(u, c), c.return = t, r.return = t, r.sibling = c, t.child = r, fc(null, r), r = t.child, c = e.child.memoizedState, c === null ? c = Cc(n) : (i = c.cachePool, i === null ? i = N() : (l = ma._currentValue, i = i.parent === l ? i : {
			parent: l,
			pool: l
		}), c = {
			baseLanes: c.baseLanes | n,
			cachePool: i
		}), r.memoizedState = c, r.childLanes = wc(e, o, n), t.memoizedState = Sc, fc(e.child, r)) : (uo(t), n = e.child, e = n.sibling, n = _i(n, {
			mode: "visible",
			children: r.children
		}), n.return = t, n.sibling = null, e !== null && (o = t.deletions, o === null ? (t.deletions = [e], t.flags |= 16) : o.push(e)), t.child = n, t.memoizedState = null, n);
	}
	function Ec(e, t) {
		return t = V({
			mode: "visible",
			children: t
		}, e.mode), t.return = e, e.child = t;
	}
	function V(e, t) {
		return e = hi(22, e, null, t), e.lanes = 0, e;
	}
	function Dc(e, t, n) {
		return Ua(t, e.child, null, n), e = Ec(t, t.pendingProps.children), e.flags |= 2, t.memoizedState = null, e;
	}
	function Oc(e, t, n) {
		e.lanes |= t;
		var r = e.alternate;
		r !== null && (r.lanes |= t), ra(e.return, t, n);
	}
	function kc(e, t, n, r, i, a) {
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
	function Ac(e, t, n) {
		var r = t.pendingProps, i = r.revealOrder, a = r.tail;
		r = r.children;
		var o = ho.current, s = !!(o & 2);
		if (s ? (o = o & 1 | 2, t.flags |= 128) : o &= 1, O(ho, o), sc(e, t, r, n), r = M ? ki : 0, !s && e !== null && e.flags & 128) a: for (e = t.child; e !== null;) {
			if (e.tag === 13) e.memoizedState !== null && Oc(e, n, t);
			else if (e.tag === 19) Oc(e, n, t);
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
				for (n = t.child, i = null; n !== null;) e = n.alternate, e !== null && go(e) === null && (i = n), n = n.sibling;
				n = i, n === null ? (i = t.child, t.child = null) : (i = n.sibling, n.sibling = null), kc(t, !1, i, n, a, r);
				break;
			case "backwards":
			case "unstable_legacy-backwards":
				for (n = null, i = t.child, t.child = null; i !== null;) {
					if (e = i.alternate, e !== null && go(e) === null) {
						t.child = i;
						break;
					}
					e = i.sibling, i.sibling = n, n = i, i = e;
				}
				kc(t, !0, n, null, a, r);
				break;
			case "together":
				kc(t, !1, null, null, void 0, r);
				break;
			default: t.memoizedState = null;
		}
		return t.child;
	}
	function jc(e, t, n) {
		if (e !== null && (t.dependencies = e.dependencies), ql |= t.lanes, (n & t.childLanes) === 0) {
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
	function Mc(e, t) {
		return (e.lanes & t) !== 0 || (e = e.dependencies, !!(e !== null && oa(e)));
	}
	function Nc(e, t, n) {
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
				if (r !== null) return r.dehydrated === null ? (n & t.child.childLanes) === 0 ? (uo(t), e = jc(e, t, n), e === null ? null : e.sibling) : Tc(e, t, n) : (uo(t), t.flags |= 128, null);
				uo(t);
				break;
			case 19:
				var i = !!(e.flags & 128);
				if (r = (n & t.childLanes) !== 0, r ||= (aa(e, t, n, !1), (n & t.childLanes) !== 0), i) {
					if (r) return Ac(e, t, n);
					t.flags |= 128;
				}
				if (i = t.memoizedState, i !== null && (i.rendering = null, i.tail = null, i.lastEffect = null), O(ho, ho.current), r) break;
				return null;
			case 22: return t.lanes = 0, dc(e, t, n, t.pendingProps);
			case 24: ta(t, ma, e.memoizedState.cache);
		}
		return jc(e, t, n);
	}
	function Pc(e, t, n) {
		if (e !== null) {
			if (e.memoizedProps !== t.pendingProps) oc = !0;
			else {
				if (!Mc(e, n) && !(t.flags & 128)) return oc = !1, Nc(e, t, n);
				oc = !!(e.flags & 131072);
			}
		} else oc = !1, M && t.flags & 1048576 && Ii(t, ki, t.index);
		switch (t.lanes = 0, t.tag) {
			case 16:
				a: {
					var r = t.pendingProps;
					if (e = Pa(t.elementType), t.type = e, typeof e == "function") gi(e) ? (r = Ys(e, r), t.tag = 1, t = bc(null, t, e, r, n)) : (t.tag = 0, t = vc(null, t, e, r, n));
					else {
						if (e != null) {
							var i = e.$$typeof;
							if (i === w) {
								t.tag = 11, t = cc(null, t, e, r, n);
								break a;
							}
							if (i === ne) {
								t.tag = 14, t = lc(null, t, e, r, n);
								break a;
							}
						}
						throw t = T(e) || e, Error(s(306, t, ""));
					}
				}
				return t;
			case 0: return vc(e, t, t.type, t.pendingProps, n);
			case 1: return r = t.type, i = Ys(r, t.pendingProps), bc(e, t, r, i, n);
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
							t = xc(e, t, r, n);
							break a;
						}
						if (r !== i) {
							i = Ti(Error(s(424)), t), Zi(i), t = xc(e, t, r, n);
							break a;
						}
						switch (e = t.stateNode.containerInfo, e.nodeType) {
							case 9:
								e = e.body;
								break;
							default: e = e.nodeName === "HTML" ? e.ownerDocument.body : e;
						}
						for (Vi = lf(e.firstChild), Bi = t, M = !0, Hi = null, Ui = !0, n = Wa(t, null, r, n), t.child = n; n;) n.flags = n.flags & -3 | 4096, n = n.sibling;
					} else {
						if (Yi(), r === i) {
							t = jc(e, t, n);
							break a;
						}
						sc(e, t, r, n);
					}
					t = t.child;
				}
				return t;
			case 26: return _c(e, t), e === null ? (n = kf(t.type, null, t.pendingProps, null)) ? t.memoizedState = n : M || (n = t.type, e = t.pendingProps, r = Vd(_e.current).createElement(n), r[gt] = t, r[_t] = e, Q(r, n, e), kt(r), t.stateNode = r) : t.memoizedState = kf(t.type, e.memoizedProps, t.pendingProps, e.memoizedState), null;
			case 27: return xe(t), e === null && M && (r = t.stateNode = pf(t.type, t.pendingProps, _e.current), Bi = t, Ui = !0, i = Vi, Qd(t.type) ? (uf = i, Vi = lf(r.firstChild)) : Vi = i), sc(e, t, t.pendingProps.children, n), _c(e, t), e === null && (t.flags |= 4194304), t.child;
			case 5: return e === null && M && ((i = r = Vi) && (r = nf(r, t.type, t.pendingProps, Ui), r === null ? i = !1 : (t.stateNode = r, Bi = t, Vi = lf(r.firstChild), Ui = !1, i = !0)), i || Gi(t)), xe(t), i = t.type, a = t.pendingProps, o = e === null ? null : e.memoizedProps, r = a.children, Wd(i, a) ? r = null : o !== null && Wd(i, o) && (t.flags |= 32), t.memoizedState !== null && (i = Oo(e, t, jo, null, null, n), Qf._currentValue = i), _c(e, t), sc(e, t, r, n), t.child;
			case 6: return e === null && M && ((e = n = Vi) && (n = rf(n, t.pendingProps, Ui), n === null ? e = !1 : (t.stateNode = n, Bi = t, Vi = null, e = !0)), e || Gi(t)), null;
			case 13: return Tc(e, t, n);
			case 4: return ye(t, t.stateNode.containerInfo), r = t.pendingProps, e === null ? t.child = Ua(t, null, r, n) : sc(e, t, r, n), t.child;
			case 11: return cc(e, t, t.type, t.pendingProps, n);
			case 7: return sc(e, t, t.pendingProps, n), t.child;
			case 8: return sc(e, t, t.pendingProps.children, n), t.child;
			case 12: return sc(e, t, t.pendingProps.children, n), t.child;
			case 10: return r = t.pendingProps, ta(t, t.type, r.value), sc(e, t, r.children, n), t.child;
			case 9: return i = t.type._context, r = t.pendingProps.children, sa(t), i = ca(i), r = r(i), t.flags |= 1, sc(e, t, r, n), t.child;
			case 14: return lc(e, t, t.type, t.pendingProps, n);
			case 15: return uc(e, t, t.type, t.pendingProps, n);
			case 19: return Ac(e, t, n);
			case 31: return gc(e, t, n);
			case 22: return dc(e, t, n, t.pendingProps);
			case 24: return sa(t), r = ca(ma), e === null ? (i = Ea(), i === null && (i = G, a = ha(), i.pooledCache = a, a.refCount++, a !== null && (i.pooledCacheLanes |= n), i = a), t.memoizedState = {
				parent: r,
				cache: i
			}, Ka(t), ta(t, ma, i)) : ((e.lanes & n) !== 0 && (qa(e, t), eo(t, null, null, n), $a()), i = e.memoizedState, a = t.memoizedState, i.parent === r ? (r = a.cache, ta(t, ma, r), r !== i.cache && ia(t, [ma], n, !0)) : (i = {
				parent: r,
				cache: r
			}, t.memoizedState = i, t.lanes === 0 && (t.memoizedState = t.updateQueue.baseState = i), ta(t, ma, r))), sc(e, t, t.pendingProps.children, n), t.child;
			case 29: throw t.pendingProps;
		}
		throw Error(s(156, t.tag));
	}
	function Fc(e) {
		e.flags |= 4;
	}
	function Ic(e, t, n, r, i) {
		if ((t = !!(e.mode & 32)) && (t = !1), t) {
			if (e.flags |= 16777216, (i & 335544128) === i) {
				if (e.stateNode.complete) e.flags |= 8192;
				else if (Eu()) e.flags |= 8192;
				else throw Fa = ja, ka;
			}
		} else e.flags &= -16777217;
	}
	function Lc(e, t) {
		if (t.type !== "stylesheet" || t.state.loading & 4) e.flags &= -16777217;
		else if (e.flags |= 16777216, !Wf(t)) {
			if (Eu()) e.flags |= 8192;
			else throw Fa = ja, ka;
		}
	}
	function Rc(e, t) {
		t !== null && (e.flags |= 4), e.flags & 16384 && (t = e.tag === 22 ? 536870912 : it(), e.lanes |= t, Zl |= t);
	}
	function zc(e, t) {
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
	function Bc(e) {
		var t = e.alternate !== null && e.alternate.child === e.child, n = 0, r = 0;
		if (t) for (var i = e.child; i !== null;) n |= i.lanes | i.childLanes, r |= i.subtreeFlags & 65011712, r |= i.flags & 65011712, i.return = e, i = i.sibling;
		else for (i = e.child; i !== null;) n |= i.lanes | i.childLanes, r |= i.subtreeFlags, r |= i.flags, i.return = e, i = i.sibling;
		return e.subtreeFlags |= r, e.childLanes = n, t;
	}
	function Vc(e, t, n) {
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
			case 14: return Bc(t), null;
			case 1: return Bc(t), null;
			case 3: return n = t.stateNode, r = null, e !== null && (r = e.memoizedState.cache), t.memoizedState.cache !== r && (t.flags |= 2048), na(ma), be(), n.pendingContext && (n.context = n.pendingContext, n.pendingContext = null), (e === null || e.child === null) && (Ji(t) ? Fc(t) : e === null || e.memoizedState.isDehydrated && !(t.flags & 256) || (t.flags |= 1024, Xi())), Bc(t), null;
			case 26:
				var i = t.type, a = t.memoizedState;
				return e === null ? (Fc(t), a === null ? (Bc(t), Ic(t, i, null, r, n)) : (Bc(t), Lc(t, a))) : a ? a === e.memoizedState ? (Bc(t), t.flags &= -16777217) : (Fc(t), Bc(t), Lc(t, a)) : (e = e.memoizedProps, e !== r && Fc(t), Bc(t), Ic(t, i, e, r, n)), null;
			case 27:
				if (Se(t), n = _e.current, i = t.type, e !== null && t.stateNode != null) e.memoizedProps !== r && Fc(t);
				else {
					if (!r) {
						if (t.stateNode === null) throw Error(s(166));
						return Bc(t), null;
					}
					e = he.current, Ji(t) ? Ki(t, e) : (e = pf(i, r, n), t.stateNode = e, Fc(t));
				}
				return Bc(t), null;
			case 5:
				if (Se(t), i = t.type, e !== null && t.stateNode != null) e.memoizedProps !== r && Fc(t);
				else {
					if (!r) {
						if (t.stateNode === null) throw Error(s(166));
						return Bc(t), null;
					}
					if (a = he.current, Ji(t)) Ki(t, a);
					else {
						var o = Vd(_e.current);
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
						a: switch (Q(a, i, r), i) {
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
						r && Fc(t);
					}
				}
				return Bc(t), Ic(t, t.type, e === null ? null : e.memoizedProps, t.pendingProps, n), null;
			case 6:
				if (e && t.stateNode != null) e.memoizedProps !== r && Fc(t);
				else {
					if (typeof r != "string" && t.stateNode === null) throw Error(s(166));
					if (e = _e.current, Ji(t)) {
						if (e = t.stateNode, n = t.memoizedProps, r = null, i = Bi, i !== null) switch (i.tag) {
							case 27:
							case 5: r = i.memoizedProps;
						}
						e[gt] = t, e = !!(e.nodeValue === n || r !== null && !0 === r.suppressHydrationWarning || Pd(e.nodeValue, n)), e || Gi(t, !0);
					} else e = Vd(e).createTextNode(r), e[gt] = t, t.stateNode = e;
				}
				return Bc(t), null;
			case 31:
				if (n = t.memoizedState, e === null || e.memoizedState !== null) {
					if (r = Ji(t), n !== null) {
						if (e === null) {
							if (!r) throw Error(s(318));
							if (e = t.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(s(557));
							e[gt] = t;
						} else Yi(), !(t.flags & 128) && (t.memoizedState = null), t.flags |= 4;
						Bc(t), e = !1;
					} else n = Xi(), e !== null && e.memoizedState !== null && (e.memoizedState.hydrationErrors = n), e = !0;
					if (!e) return t.flags & 256 ? (mo(t), t) : (mo(t), null);
					if (t.flags & 128) throw Error(s(558));
				}
				return Bc(t), null;
			case 13:
				if (r = t.memoizedState, e === null || e.memoizedState !== null && e.memoizedState.dehydrated !== null) {
					if (i = Ji(t), r !== null && r.dehydrated !== null) {
						if (e === null) {
							if (!i) throw Error(s(318));
							if (i = t.memoizedState, i = i === null ? null : i.dehydrated, !i) throw Error(s(317));
							i[gt] = t;
						} else Yi(), !(t.flags & 128) && (t.memoizedState = null), t.flags |= 4;
						Bc(t), i = !1;
					} else i = Xi(), e !== null && e.memoizedState !== null && (e.memoizedState.hydrationErrors = i), i = !0;
					if (!i) return t.flags & 256 ? (mo(t), t) : (mo(t), null);
				}
				return mo(t), t.flags & 128 ? (t.lanes = n, t) : (n = r !== null, e = e !== null && e.memoizedState !== null, n && (r = t.child, i = null, r.alternate !== null && r.alternate.memoizedState !== null && r.alternate.memoizedState.cachePool !== null && (i = r.alternate.memoizedState.cachePool.pool), a = null, r.memoizedState !== null && r.memoizedState.cachePool !== null && (a = r.memoizedState.cachePool.pool), a !== i && (r.flags |= 2048)), n !== e && n && (t.child.flags |= 8192), Rc(t, t.updateQueue), Bc(t), null);
			case 4: return be(), e === null && wd(t.stateNode.containerInfo), Bc(t), null;
			case 10: return na(t.type), Bc(t), null;
			case 19:
				if (me(ho), r = t.memoizedState, r === null) return Bc(t), null;
				if (i = !!(t.flags & 128), a = r.rendering, a === null) {
					if (i) zc(r, !1);
					else {
						if (Kl !== 0 || e !== null && e.flags & 128) for (e = t.child; e !== null;) {
							if (a = go(e), a !== null) {
								for (t.flags |= 128, zc(r, !1), e = a.updateQueue, t.updateQueue = e, Rc(t, e), t.subtreeFlags = 0, e = n, n = t.child; n !== null;) vi(n, e), n = n.sibling;
								return O(ho, ho.current & 1 | 2), M && Fi(t, r.treeForkCount), t.child;
							}
							e = e.sibling;
						}
						r.tail !== null && Fe() > ru && (t.flags |= 128, i = !0, zc(r, !1), t.lanes = 4194304);
					}
				} else {
					if (!i) {
						if (e = go(a), e !== null) {
							if (t.flags |= 128, i = !0, e = e.updateQueue, t.updateQueue = e, Rc(t, e), zc(r, !0), r.tail === null && r.tailMode === "hidden" && !a.alternate && !M) return Bc(t), null;
						} else 2 * Fe() - r.renderingStartTime > ru && n !== 536870912 && (t.flags |= 128, i = !0, zc(r, !1), t.lanes = 4194304);
					}
					r.isBackwards ? (a.sibling = t.child, t.child = a) : (e = r.last, e === null ? t.child = a : e.sibling = a, r.last = a);
				}
				return r.tail === null ? (Bc(t), null) : (e = r.tail, r.rendering = e, r.tail = e.sibling, r.renderingStartTime = Fe(), e.sibling = null, n = ho.current, O(ho, i ? n & 1 | 2 : n & 1), M && Fi(t, r.treeForkCount), e);
			case 22:
			case 23: return mo(t), so(), r = t.memoizedState !== null, e === null ? r && (t.flags |= 8192) : e.memoizedState !== null !== r && (t.flags |= 8192), r ? n & 536870912 && !(t.flags & 128) && (Bc(t), t.subtreeFlags & 6 && (t.flags |= 8192)) : Bc(t), n = t.updateQueue, n !== null && Rc(t, n.retryQueue), n = null, e !== null && e.memoizedState !== null && e.memoizedState.cachePool !== null && (n = e.memoizedState.cachePool.pool), r = null, t.memoizedState !== null && t.memoizedState.cachePool !== null && (r = t.memoizedState.cachePool.pool), r !== n && (t.flags |= 2048), e !== null && me(Ta), null;
			case 24: return n = null, e !== null && (n = e.memoizedState.cache), t.memoizedState.cache !== n && (t.flags |= 2048), na(ma), Bc(t), null;
			case 25: return null;
			case 30: return null;
		}
		throw Error(s(156, t.tag));
	}
	function Hc(e, t) {
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
			case 19: return me(ho), null;
			case 4: return be(), null;
			case 10: return na(t.type), null;
			case 22:
			case 23: return mo(t), so(), e !== null && me(Ta), e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 24: return na(ma), null;
			case 25: return null;
			default: return null;
		}
	}
	function Uc(e, t) {
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
				me(ho);
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
	function Wc(e, t) {
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
			Y(t, t.return, e);
		}
	}
	function Gc(e, t, n) {
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
								Y(i, c, e);
							}
						}
					}
					r = r.next;
				} while (r !== a);
			}
		} catch (e) {
			Y(t, t.return, e);
		}
	}
	function Kc(e) {
		var t = e.updateQueue;
		if (t !== null) {
			var n = e.stateNode;
			try {
				no(t, n);
			} catch (t) {
				Y(e, e.return, t);
			}
		}
	}
	function qc(e, t, n) {
		n.props = Ys(e.type, e.memoizedProps), n.state = e.memoizedState;
		try {
			n.componentWillUnmount();
		} catch (n) {
			Y(e, t, n);
		}
	}
	function Jc(e, t) {
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
			Y(e, t, n);
		}
	}
	function Yc(e, t) {
		var n = e.ref, r = e.refCleanup;
		if (n !== null) {
			if (typeof r == "function") try {
				r();
			} catch (n) {
				Y(e, t, n);
			} finally {
				e.refCleanup = null, e = e.alternate, e != null && (e.refCleanup = null);
			}
			else if (typeof n == "function") try {
				n(null);
			} catch (n) {
				Y(e, t, n);
			}
			else n.current = null;
		}
	}
	function Xc(e) {
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
			Y(e, e.return, t);
		}
	}
	function Zc(e, t, n) {
		try {
			var r = e.stateNode;
			Id(r, e.type, n, t), r[_t] = t;
		} catch (t) {
			Y(e, e.return, t);
		}
	}
	function Qc(e) {
		return e.tag === 5 || e.tag === 3 || e.tag === 26 || e.tag === 27 && Qd(e.type) || e.tag === 4;
	}
	function $c(e) {
		a: for (;;) {
			for (; e.sibling === null;) {
				if (e.return === null || Qc(e.return)) return null;
				e = e.return;
			}
			for (e.sibling.return = e.return, e = e.sibling; e.tag !== 5 && e.tag !== 6 && e.tag !== 18;) {
				if (e.tag === 27 && Qd(e.type) || e.flags & 2 || e.child === null || e.tag === 4) continue a;
				e.child.return = e, e = e.child;
			}
			if (!(e.flags & 2)) return e.stateNode;
		}
	}
	function H(e, t, n) {
		var r = e.tag;
		if (r === 5 || r === 6) e = e.stateNode, t ? (n.nodeType === 9 ? n.body : n.nodeName === "HTML" ? n.ownerDocument.body : n).insertBefore(e, t) : (t = n.nodeType === 9 ? n.body : n.nodeName === "HTML" ? n.ownerDocument.body : n, t.appendChild(e), n = n._reactRootContainer, n != null || t.onclick !== null || (t.onclick = un));
		else if (r !== 4 && (r === 27 && Qd(e.type) && (n = e.stateNode, t = null), e = e.child, e !== null)) for (H(e, t, n), e = e.sibling; e !== null;) H(e, t, n), e = e.sibling;
	}
	function el(e, t, n) {
		var r = e.tag;
		if (r === 5 || r === 6) e = e.stateNode, t ? n.insertBefore(e, t) : n.appendChild(e);
		else if (r !== 4 && (r === 27 && Qd(e.type) && (n = e.stateNode), e = e.child, e !== null)) for (el(e, t, n), e = e.sibling; e !== null;) el(e, t, n), e = e.sibling;
	}
	function tl(e) {
		var t = e.stateNode, n = e.memoizedProps;
		try {
			for (var r = e.type, i = t.attributes; i.length;) t.removeAttributeNode(i[0]);
			Q(t, r, n), t[gt] = e, t[_t] = n;
		} catch (t) {
			Y(e, e.return, t);
		}
	}
	var nl = !1, rl = !1, il = !1, al = typeof WeakSet == "function" ? WeakSet : Set, ol = null;
	function sl(e, t) {
		if (e = e.containerInfo, zd = sp, e = Pr(e), Fr(e)) {
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
		for (Bd = {
			focusedElem: e,
			selectionRange: n
		}, sp = !1, ol = t; ol !== null;) if (t = ol, e = t.child, t.subtreeFlags & 1028 && e !== null) e.return = t, ol = e;
		else for (; ol !== null;) {
			switch (t = ol, a = t.alternate, e = t.flags, t.tag) {
				case 0:
					if (e & 4 && (e = t.updateQueue, e = e === null ? null : e.events, e !== null)) for (n = 0; n < e.length; n++) i = e[n], i.ref.impl = i.nextImpl;
					break;
				case 11:
				case 15: break;
				case 1:
					if (e & 1024 && a !== null) {
						e = void 0, n = t, i = a.memoizedProps, a = a.memoizedState, r = n.stateNode;
						try {
							var h = Ys(n.type, i);
							e = r.getSnapshotBeforeUpdate(h, a), r.__reactInternalSnapshotBeforeUpdate = e;
						} catch (e) {
							Y(n, n.return, e);
						}
					}
					break;
				case 3:
					if (e & 1024) {
						if (e = t.stateNode.containerInfo, n = e.nodeType, n === 9) tf(e);
						else if (n === 1) switch (e.nodeName) {
							case "HEAD":
							case "HTML":
							case "BODY":
								tf(e);
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
				e.return = t.return, ol = e;
				break;
			}
			ol = t.return;
		}
	}
	function cl(e, t, n) {
		var r = n.flags;
		switch (n.tag) {
			case 0:
			case 11:
			case 15:
				Cl(e, n), r & 4 && Wc(5, n);
				break;
			case 1:
				if (Cl(e, n), r & 4) {
					if (e = n.stateNode, t === null) try {
						e.componentDidMount();
					} catch (e) {
						Y(n, n.return, e);
					}
					else {
						var i = Ys(n.type, t.memoizedProps);
						t = t.memoizedState;
						try {
							e.componentDidUpdate(i, t, e.__reactInternalSnapshotBeforeUpdate);
						} catch (e) {
							Y(n, n.return, e);
						}
					}
				}
				r & 64 && Kc(n), r & 512 && Jc(n, n.return);
				break;
			case 3:
				if (Cl(e, n), r & 64 && (e = n.updateQueue, e !== null)) {
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
						Y(n, n.return, e);
					}
				}
				break;
			case 27: t === null && r & 4 && tl(n);
			case 26:
			case 5:
				Cl(e, n), t === null && r & 4 && Xc(n), r & 512 && Jc(n, n.return);
				break;
			case 12:
				Cl(e, n);
				break;
			case 31:
				Cl(e, n), r & 4 && ml(e, n);
				break;
			case 13:
				Cl(e, n), r & 4 && hl(e, n), r & 64 && (e = n.memoizedState, e !== null && (e = e.dehydrated, e !== null && (n = Xu.bind(null, n), cf(e, n))));
				break;
			case 22:
				if (r = n.memoizedState !== null || nl, !r) {
					t = t !== null && t.memoizedState !== null || rl, i = nl;
					var a = rl;
					nl = r, (rl = t) && !a ? Tl(e, n, !!(n.subtreeFlags & 8772)) : Cl(e, n), nl = i, rl = a;
				}
				break;
			case 30: break;
			default: Cl(e, n);
		}
	}
	function ll(e) {
		var t = e.alternate;
		t !== null && (e.alternate = null, ll(t)), e.child = null, e.deletions = null, e.sibling = null, e.tag === 5 && (t = e.stateNode, t !== null && wt(t)), e.stateNode = null, e.return = null, e.dependencies = null, e.memoizedProps = null, e.memoizedState = null, e.pendingProps = null, e.stateNode = null, e.updateQueue = null;
	}
	var ul = null, dl = !1;
	function fl(e, t, n) {
		for (n = n.child; n !== null;) pl(e, t, n), n = n.sibling;
	}
	function pl(e, t, n) {
		if (Ge && typeof Ge.onCommitFiberUnmount == "function") try {
			Ge.onCommitFiberUnmount(We, n);
		} catch {}
		switch (n.tag) {
			case 26:
				rl || Yc(n, t), fl(e, t, n), n.memoizedState ? n.memoizedState.count-- : n.stateNode && (n = n.stateNode, n.parentNode.removeChild(n));
				break;
			case 27:
				rl || Yc(n, t);
				var r = ul, i = dl;
				Qd(n.type) && (ul = n.stateNode, dl = !1), fl(e, t, n), mf(n.stateNode), ul = r, dl = i;
				break;
			case 5: rl || Yc(n, t);
			case 6:
				if (r = ul, i = dl, ul = null, fl(e, t, n), ul = r, dl = i, ul !== null) {
					if (dl) try {
						(ul.nodeType === 9 ? ul.body : ul.nodeName === "HTML" ? ul.ownerDocument.body : ul).removeChild(n.stateNode);
					} catch (e) {
						Y(n, t, e);
					}
					else try {
						ul.removeChild(n.stateNode);
					} catch (e) {
						Y(n, t, e);
					}
				}
				break;
			case 18:
				ul !== null && (dl ? (e = ul, $d(e.nodeType === 9 ? e.body : e.nodeName === "HTML" ? e.ownerDocument.body : e, n.stateNode), Np(e)) : $d(ul, n.stateNode));
				break;
			case 4:
				r = ul, i = dl, ul = n.stateNode.containerInfo, dl = !0, fl(e, t, n), ul = r, dl = i;
				break;
			case 0:
			case 11:
			case 14:
			case 15:
				Gc(2, n, t), rl || Gc(4, n, t), fl(e, t, n);
				break;
			case 1:
				rl || (Yc(n, t), r = n.stateNode, typeof r.componentWillUnmount == "function" && qc(n, t, r)), fl(e, t, n);
				break;
			case 21:
				fl(e, t, n);
				break;
			case 22:
				rl = (r = rl) || n.memoizedState !== null, fl(e, t, n), rl = r;
				break;
			default: fl(e, t, n);
		}
	}
	function ml(e, t) {
		if (t.memoizedState === null && (e = t.alternate, e !== null && (e = e.memoizedState, e !== null))) {
			e = e.dehydrated;
			try {
				Np(e);
			} catch (e) {
				Y(t, t.return, e);
			}
		}
	}
	function hl(e, t) {
		if (t.memoizedState === null && (e = t.alternate, e !== null && (e = e.memoizedState, e !== null && (e = e.dehydrated, e !== null)))) try {
			Np(e);
		} catch (e) {
			Y(t, t.return, e);
		}
	}
	function gl(e) {
		switch (e.tag) {
			case 31:
			case 13:
			case 19:
				var t = e.stateNode;
				return t === null && (t = e.stateNode = new al()), t;
			case 22: return e = e.stateNode, t = e._retryCache, t === null && (t = e._retryCache = new al()), t;
			default: throw Error(s(435, e.tag));
		}
	}
	function _l(e, t) {
		var n = gl(e);
		t.forEach(function(t) {
			if (!n.has(t)) {
				n.add(t);
				var r = Zu.bind(null, e, t);
				t.then(r, r);
			}
		});
	}
	function vl(e, t) {
		var n = t.deletions;
		if (n !== null) for (var r = 0; r < n.length; r++) {
			var i = n[r], a = e, o = t, c = o;
			a: for (; c !== null;) {
				switch (c.tag) {
					case 27:
						if (Qd(c.type)) {
							ul = c.stateNode, dl = !1;
							break a;
						}
						break;
					case 5:
						ul = c.stateNode, dl = !1;
						break a;
					case 3:
					case 4:
						ul = c.stateNode.containerInfo, dl = !0;
						break a;
				}
				c = c.return;
			}
			if (ul === null) throw Error(s(160));
			pl(a, o, i), ul = null, dl = !1, a = i.alternate, a !== null && (a.return = null), i.return = null;
		}
		if (t.subtreeFlags & 13886) for (t = t.child; t !== null;) bl(t, e), t = t.sibling;
	}
	var yl = null;
	function bl(e, t) {
		var n = e.alternate, r = e.flags;
		switch (e.tag) {
			case 0:
			case 11:
			case 14:
			case 15:
				vl(t, e), xl(e), r & 4 && (Gc(3, e, e.return), Wc(3, e), Gc(5, e, e.return));
				break;
			case 1:
				vl(t, e), xl(e), r & 512 && (rl || n === null || Yc(n, n.return)), r & 64 && nl && (e = e.updateQueue, e !== null && (r = e.callbacks, r !== null && (n = e.shared.hiddenCallbacks, e.shared.hiddenCallbacks = n === null ? r : n.concat(r))));
				break;
			case 26:
				var i = yl;
				if (vl(t, e), xl(e), r & 512 && (rl || n === null || Yc(n, n.return)), r & 4) {
					var a = n === null ? null : n.memoizedState;
					if (r = e.memoizedState, n === null) {
						if (r === null) {
							if (e.stateNode === null) {
								a: {
									r = e.type, n = e.memoizedProps, i = i.ownerDocument || i;
									b: switch (r) {
										case "title":
											a = i.getElementsByTagName("title")[0], (!a || a[Ct] || a[gt] || a.namespaceURI === "http://www.w3.org/2000/svg" || a.hasAttribute("itemprop")) && (a = i.createElement(r), i.head.insertBefore(a, i.querySelector("head > title"))), Q(a, r, n), a[gt] = e, kt(a), r = a;
											break a;
										case "link":
											var o = Vf("link", "href", i).get(r + (n.href || ""));
											if (o) {
												for (var c = 0; c < o.length; c++) if (a = o[c], a.getAttribute("href") === (n.href == null || n.href === "" ? null : n.href) && a.getAttribute("rel") === (n.rel == null ? null : n.rel) && a.getAttribute("title") === (n.title == null ? null : n.title) && a.getAttribute("crossorigin") === (n.crossOrigin == null ? null : n.crossOrigin)) {
													o.splice(c, 1);
													break b;
												}
											}
											a = i.createElement(r), Q(a, r, n), i.head.appendChild(a);
											break;
										case "meta":
											if (o = Vf("meta", "content", i).get(r + (n.content || ""))) {
												for (c = 0; c < o.length; c++) if (a = o[c], a.getAttribute("content") === (n.content == null ? null : "" + n.content) && a.getAttribute("name") === (n.name == null ? null : n.name) && a.getAttribute("property") === (n.property == null ? null : n.property) && a.getAttribute("http-equiv") === (n.httpEquiv == null ? null : n.httpEquiv) && a.getAttribute("charset") === (n.charSet == null ? null : n.charSet)) {
													o.splice(c, 1);
													break b;
												}
											}
											a = i.createElement(r), Q(a, r, n), i.head.appendChild(a);
											break;
										default: throw Error(s(468, r));
									}
									a[gt] = e, kt(a), r = a;
								}
								e.stateNode = r;
							} else Hf(i, e.type, e.stateNode);
						} else e.stateNode = If(i, r, e.memoizedProps);
					} else a === r ? r === null && e.stateNode !== null && Zc(e, e.memoizedProps, n.memoizedProps) : (a === null ? n.stateNode !== null && (n = n.stateNode, n.parentNode.removeChild(n)) : a.count--, r === null ? Hf(i, e.type, e.stateNode) : If(i, r, e.memoizedProps));
				}
				break;
			case 27:
				vl(t, e), xl(e), r & 512 && (rl || n === null || Yc(n, n.return)), n !== null && r & 4 && Zc(e, e.memoizedProps, n.memoizedProps);
				break;
			case 5:
				if (vl(t, e), xl(e), r & 512 && (rl || n === null || Yc(n, n.return)), e.flags & 32) {
					i = e.stateNode;
					try {
						tn(i, "");
					} catch (t) {
						Y(e, e.return, t);
					}
				}
				r & 4 && e.stateNode != null && (i = e.memoizedProps, Zc(e, i, n === null ? i : n.memoizedProps)), r & 1024 && (il = !0);
				break;
			case 6:
				if (vl(t, e), xl(e), r & 4) {
					if (e.stateNode === null) throw Error(s(162));
					r = e.memoizedProps, n = e.stateNode;
					try {
						n.nodeValue = r;
					} catch (t) {
						Y(e, e.return, t);
					}
				}
				break;
			case 3:
				if (Bf = null, i = yl, yl = gf(t.containerInfo), vl(t, e), yl = i, xl(e), r & 4 && n !== null && n.memoizedState.isDehydrated) try {
					Np(t.containerInfo);
				} catch (t) {
					Y(e, e.return, t);
				}
				il && (il = !1, Sl(e));
				break;
			case 4:
				r = yl, yl = gf(e.stateNode.containerInfo), vl(t, e), xl(e), yl = r;
				break;
			case 12:
				vl(t, e), xl(e);
				break;
			case 31:
				vl(t, e), xl(e), r & 4 && (r = e.updateQueue, r !== null && (e.updateQueue = null, _l(e, r)));
				break;
			case 13:
				vl(t, e), xl(e), e.child.flags & 8192 && e.memoizedState !== null != (n !== null && n.memoizedState !== null) && (tu = Fe()), r & 4 && (r = e.updateQueue, r !== null && (e.updateQueue = null, _l(e, r)));
				break;
			case 22:
				i = e.memoizedState !== null;
				var l = n !== null && n.memoizedState !== null, u = nl, d = rl;
				if (nl = u || i, rl = d || l, vl(t, e), rl = d, nl = u, xl(e), r & 8192) a: for (t = e.stateNode, t._visibility = i ? t._visibility & -2 : t._visibility | 1, i && (n === null || l || nl || rl || wl(e)), n = null, t = e;;) {
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
								Y(l, l.return, e);
							}
						}
					} else if (t.tag === 6) {
						if (n === null) {
							l = t;
							try {
								l.stateNode.nodeValue = i ? "" : l.memoizedProps;
							} catch (e) {
								Y(l, l.return, e);
							}
						}
					} else if (t.tag === 18) {
						if (n === null) {
							l = t;
							try {
								var m = l.stateNode;
								i ? ef(m, !0) : ef(l.stateNode, !1);
							} catch (e) {
								Y(l, l.return, e);
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
				r & 4 && (r = e.updateQueue, r !== null && (n = r.retryQueue, n !== null && (r.retryQueue = null, _l(e, n))));
				break;
			case 19:
				vl(t, e), xl(e), r & 4 && (r = e.updateQueue, r !== null && (e.updateQueue = null, _l(e, r)));
				break;
			case 30: break;
			case 21: break;
			default: vl(t, e), xl(e);
		}
	}
	function xl(e) {
		var t = e.flags;
		if (t & 2) {
			try {
				for (var n, r = e.return; r !== null;) {
					if (Qc(r)) {
						n = r;
						break;
					}
					r = r.return;
				}
				if (n == null) throw Error(s(160));
				switch (n.tag) {
					case 27:
						var i = n.stateNode;
						el(e, $c(e), i);
						break;
					case 5:
						var a = n.stateNode;
						n.flags & 32 && (tn(a, ""), n.flags &= -33), el(e, $c(e), a);
						break;
					case 3:
					case 4:
						var o = n.stateNode.containerInfo;
						H(e, $c(e), o);
						break;
					default: throw Error(s(161));
				}
			} catch (t) {
				Y(e, e.return, t);
			}
			e.flags &= -3;
		}
		t & 4096 && (e.flags &= -4097);
	}
	function Sl(e) {
		if (e.subtreeFlags & 1024) for (e = e.child; e !== null;) {
			var t = e;
			Sl(t), t.tag === 5 && t.flags & 1024 && t.stateNode.reset(), e = e.sibling;
		}
	}
	function Cl(e, t) {
		if (t.subtreeFlags & 8772) for (t = t.child; t !== null;) cl(e, t.alternate, t), t = t.sibling;
	}
	function wl(e) {
		for (e = e.child; e !== null;) {
			var t = e;
			switch (t.tag) {
				case 0:
				case 11:
				case 14:
				case 15:
					Gc(4, t, t.return), wl(t);
					break;
				case 1:
					Yc(t, t.return);
					var n = t.stateNode;
					typeof n.componentWillUnmount == "function" && qc(t, t.return, n), wl(t);
					break;
				case 27: mf(t.stateNode);
				case 26:
				case 5:
					Yc(t, t.return), wl(t);
					break;
				case 22:
					t.memoizedState === null && wl(t);
					break;
				case 30:
					wl(t);
					break;
				default: wl(t);
			}
			e = e.sibling;
		}
	}
	function Tl(e, t, n) {
		for (n &&= !!(t.subtreeFlags & 8772), t = t.child; t !== null;) {
			var r = t.alternate, i = e, a = t, o = a.flags;
			switch (a.tag) {
				case 0:
				case 11:
				case 15:
					Tl(i, a, n), Wc(4, a);
					break;
				case 1:
					if (Tl(i, a, n), r = a, i = r.stateNode, typeof i.componentDidMount == "function") try {
						i.componentDidMount();
					} catch (e) {
						Y(r, r.return, e);
					}
					if (r = a, i = r.updateQueue, i !== null) {
						var s = r.stateNode;
						try {
							var c = i.shared.hiddenCallbacks;
							if (c !== null) for (i.shared.hiddenCallbacks = null, i = 0; i < c.length; i++) to(c[i], s);
						} catch (e) {
							Y(r, r.return, e);
						}
					}
					n && o & 64 && Kc(a), Jc(a, a.return);
					break;
				case 27: tl(a);
				case 26:
				case 5:
					Tl(i, a, n), n && r === null && o & 4 && Xc(a), Jc(a, a.return);
					break;
				case 12:
					Tl(i, a, n);
					break;
				case 31:
					Tl(i, a, n), n && o & 4 && ml(i, a);
					break;
				case 13:
					Tl(i, a, n), n && o & 4 && hl(i, a);
					break;
				case 22:
					a.memoizedState === null && Tl(i, a, n), Jc(a, a.return);
					break;
				case 30: break;
				default: Tl(i, a, n);
			}
			t = t.sibling;
		}
	}
	function El(e, t) {
		var n = null;
		e !== null && e.memoizedState !== null && e.memoizedState.cachePool !== null && (n = e.memoizedState.cachePool.pool), e = null, t.memoizedState !== null && t.memoizedState.cachePool !== null && (e = t.memoizedState.cachePool.pool), e !== n && (e != null && e.refCount++, n != null && ga(n));
	}
	function Dl(e, t) {
		e = null, t.alternate !== null && (e = t.alternate.memoizedState.cache), t = t.memoizedState.cache, t !== e && (t.refCount++, e != null && ga(e));
	}
	function Ol(e, t, n, r) {
		if (t.subtreeFlags & 10256) for (t = t.child; t !== null;) kl(e, t, n, r), t = t.sibling;
	}
	function kl(e, t, n, r) {
		var i = t.flags;
		switch (t.tag) {
			case 0:
			case 11:
			case 15:
				Ol(e, t, n, r), i & 2048 && Wc(9, t);
				break;
			case 1:
				Ol(e, t, n, r);
				break;
			case 3:
				Ol(e, t, n, r), i & 2048 && (e = null, t.alternate !== null && (e = t.alternate.memoizedState.cache), t = t.memoizedState.cache, t !== e && (t.refCount++, e != null && ga(e)));
				break;
			case 12:
				if (i & 2048) {
					Ol(e, t, n, r), e = t.stateNode;
					try {
						var a = t.memoizedProps, o = a.id, s = a.onPostCommit;
						typeof s == "function" && s(o, t.alternate === null ? "mount" : "update", e.passiveEffectDuration, -0);
					} catch (e) {
						Y(t, t.return, e);
					}
				} else Ol(e, t, n, r);
				break;
			case 31:
				Ol(e, t, n, r);
				break;
			case 13:
				Ol(e, t, n, r);
				break;
			case 23: break;
			case 22:
				a = t.stateNode, o = t.alternate, t.memoizedState === null ? a._visibility & 2 ? Ol(e, t, n, r) : (a._visibility |= 2, Al(e, t, n, r, !!(t.subtreeFlags & 10256) || !1)) : a._visibility & 2 ? Ol(e, t, n, r) : jl(e, t), i & 2048 && El(o, t);
				break;
			case 24:
				Ol(e, t, n, r), i & 2048 && Dl(t.alternate, t);
				break;
			default: Ol(e, t, n, r);
		}
	}
	function Al(e, t, n, r, i) {
		for (i &&= !!(t.subtreeFlags & 10256) || !1, t = t.child; t !== null;) {
			var a = e, o = t, s = n, c = r, l = o.flags;
			switch (o.tag) {
				case 0:
				case 11:
				case 15:
					Al(a, o, s, c, i), Wc(8, o);
					break;
				case 23: break;
				case 22:
					var u = o.stateNode;
					o.memoizedState === null ? (u._visibility |= 2, Al(a, o, s, c, i)) : u._visibility & 2 ? Al(a, o, s, c, i) : jl(a, o), i && l & 2048 && El(o.alternate, o);
					break;
				case 24:
					Al(a, o, s, c, i), i && l & 2048 && Dl(o.alternate, o);
					break;
				default: Al(a, o, s, c, i);
			}
			t = t.sibling;
		}
	}
	function jl(e, t) {
		if (t.subtreeFlags & 10256) for (t = t.child; t !== null;) {
			var n = e, r = t, i = r.flags;
			switch (r.tag) {
				case 22:
					jl(n, r), i & 2048 && El(r.alternate, r);
					break;
				case 24:
					jl(n, r), i & 2048 && Dl(r.alternate, r);
					break;
				default: jl(n, r);
			}
			t = t.sibling;
		}
	}
	var Ml = 8192;
	function Nl(e, t, n) {
		if (e.subtreeFlags & Ml) for (e = e.child; e !== null;) Pl(e, t, n), e = e.sibling;
	}
	function Pl(e, t, n) {
		switch (e.tag) {
			case 26:
				Nl(e, t, n), e.flags & Ml && e.memoizedState !== null && Gf(n, yl, e.memoizedState, e.memoizedProps);
				break;
			case 5:
				Nl(e, t, n);
				break;
			case 3:
			case 4:
				var r = yl;
				yl = gf(e.stateNode.containerInfo), Nl(e, t, n), yl = r;
				break;
			case 22:
				e.memoizedState === null && (r = e.alternate, r !== null && r.memoizedState !== null ? (r = Ml, Ml = 16777216, Nl(e, t, n), Ml = r) : Nl(e, t, n));
				break;
			default: Nl(e, t, n);
		}
	}
	function Fl(e) {
		var t = e.alternate;
		if (t !== null && (e = t.child, e !== null)) {
			t.child = null;
			do
				t = e.sibling, e.sibling = null, e = t;
			while (e !== null);
		}
	}
	function Il(e) {
		var t = e.deletions;
		if (e.flags & 16) {
			if (t !== null) for (var n = 0; n < t.length; n++) {
				var r = t[n];
				ol = r, Rl(r, e);
			}
			Fl(e);
		}
		if (e.subtreeFlags & 10256) for (e = e.child; e !== null;) U(e), e = e.sibling;
	}
	function U(e) {
		switch (e.tag) {
			case 0:
			case 11:
			case 15:
				Il(e), e.flags & 2048 && Gc(9, e, e.return);
				break;
			case 3:
				Il(e);
				break;
			case 12:
				Il(e);
				break;
			case 22:
				var t = e.stateNode;
				e.memoizedState !== null && t._visibility & 2 && (e.return === null || e.return.tag !== 13) ? (t._visibility &= -3, Ll(e)) : Il(e);
				break;
			default: Il(e);
		}
	}
	function Ll(e) {
		var t = e.deletions;
		if (e.flags & 16) {
			if (t !== null) for (var n = 0; n < t.length; n++) {
				var r = t[n];
				ol = r, Rl(r, e);
			}
			Fl(e);
		}
		for (e = e.child; e !== null;) {
			switch (t = e, t.tag) {
				case 0:
				case 11:
				case 15:
					Gc(8, t, t.return), Ll(t);
					break;
				case 22:
					n = t.stateNode, n._visibility & 2 && (n._visibility &= -3, Ll(t));
					break;
				default: Ll(t);
			}
			e = e.sibling;
		}
	}
	function Rl(e, t) {
		for (; ol !== null;) {
			var n = ol;
			switch (n.tag) {
				case 0:
				case 11:
				case 15:
					Gc(8, n, t);
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
			if (r = n.child, r !== null) r.return = n, ol = r;
			else a: for (n = e; ol !== null;) {
				r = ol;
				var i = r.sibling, a = r.return;
				if (ll(r), r === n) {
					ol = null;
					break a;
				}
				if (i !== null) {
					i.return = a, ol = i;
					break a;
				}
				ol = a;
			}
		}
	}
	var zl = {
		getCacheForType: function(e) {
			var t = ca(ma), n = t.data.get(e);
			return n === void 0 && (n = e(), t.data.set(e, n)), n;
		},
		cacheSignal: function() {
			return ca(ma).controller.signal;
		}
	}, Bl = typeof WeakMap == "function" ? WeakMap : Map, W = 0, G = null, K = null, q = 0, J = 0, Vl = null, Hl = !1, Ul = !1, Wl = !1, Gl = 0, Kl = 0, ql = 0, Jl = 0, Yl = 0, Xl = 0, Zl = 0, Ql = null, $l = null, eu = !1, tu = 0, nu = 0, ru = Infinity, iu = null, au = null, ou = 0, su = null, cu = null, lu = 0, uu = 0, du = null, fu = null, pu = 0, mu = null;
	function hu() {
		return W & 2 && q !== 0 ? q & -q : E.T === null ? pt() : pd();
	}
	function gu() {
		if (Xl === 0) {
			if (!(q & 536870912) || M) {
				var e = Qe;
				Qe <<= 1, !(Qe & 3932160) && (Qe = 262144), Xl = e;
			} else Xl = 536870912;
		}
		return e = co.current, e !== null && (e.flags |= 32), Xl;
	}
	function _u(e, t, n) {
		(e === G && (J === 2 || J === 9) || e.cancelPendingCommit !== null) && (wu(e, 0), xu(e, q, Xl, !1)), ot(e, n), (!(W & 2) || e !== G) && (e === G && (!(W & 2) && (Jl |= n), Kl === 4 && xu(e, q, Xl, !1)), ad(e));
	}
	function vu(e, t, n) {
		if (W & 6) throw Error(s(327));
		var r = !n && !(t & 127) && (t & e.expiredLanes) === 0 || nt(e, t), i = r ? Mu(e, t) : Au(e, t, !0), a = r;
		do {
			if (i === 0) {
				Ul && !r && xu(e, t, 0, !1);
				break;
			}
			if (n = e.current.alternate, a && !bu(n)) {
				i = Au(e, t, !1), a = !1;
				continue;
			}
			if (i === 2) {
				if (a = t, e.errorRecoveryDisabledLanes & a) var o = 0;
				else o = e.pendingLanes & -536870913, o = o === 0 ? o & 536870912 ? 536870912 : 0 : o;
				if (o !== 0) {
					t = o;
					a: {
						var c = e;
						i = Ql;
						var l = c.current.memoizedState.isDehydrated;
						if (l && (wu(c, o).flags |= 256), o = Au(c, o, !1), o !== 2) {
							if (Wl && !l) {
								c.errorRecoveryDisabledLanes |= a, Jl |= a, i = 4;
								break a;
							}
							a = $l, $l = i, a !== null && ($l === null ? $l = a : $l.push.apply($l, a));
						}
						i = o;
					}
					if (a = !1, i !== 2) continue;
				}
			}
			if (i === 1) {
				wu(e, 0), xu(e, t, 0, !0);
				break;
			}
			a: {
				switch (r = e, a = i, a) {
					case 0:
					case 1: throw Error(s(345));
					case 4: if ((t & 4194048) !== t) break;
					case 6:
						xu(r, t, Xl, !Hl);
						break a;
					case 2:
						$l = null;
						break;
					case 3:
					case 5: break;
					default: throw Error(s(329));
				}
				if ((t & 62914560) === t && (i = tu + 300 - Fe(), 10 < i)) {
					if (xu(r, t, Xl, !Hl), tt(r, 0, !0) !== 0) break a;
					lu = t, r.timeoutHandle = qd(yu.bind(null, r, n, $l, iu, eu, t, Xl, Jl, Zl, Hl, a, "Throttled", -0, 0), i);
					break a;
				}
				yu(r, n, $l, iu, eu, t, Xl, Jl, Zl, Hl, a, null, -0, 0);
			}
			break;
		} while (1);
		ad(e);
	}
	function yu(e, t, n, r, i, a, o, s, c, l, u, d, f, p) {
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
			}, Pl(t, a, d);
			var m = (a & 62914560) === a ? tu - Fe() : (a & 4194048) === a ? nu - Fe() : 0;
			if (m = qf(d, m), m !== null) {
				lu = a, e.cancelPendingCommit = m(zu.bind(null, e, t, a, n, r, i, o, s, c, u, d, null, f, p)), xu(e, a, o, !l);
				return;
			}
		}
		zu(e, t, a, n, r, i, o, s, c);
	}
	function bu(e) {
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
	function xu(e, t, n, r) {
		t &= ~Yl, t &= ~Jl, e.suspendedLanes |= t, e.pingedLanes &= ~t, r && (e.warmLanes |= t), r = e.expirationTimes;
		for (var i = t; 0 < i;) {
			var a = 31 - qe(i), o = 1 << a;
			r[a] = -1, i &= ~o;
		}
		n !== 0 && ct(e, n, t);
	}
	function Su() {
		return W & 6 ? !0 : (od(0, !1), !1);
	}
	function Cu() {
		if (K !== null) {
			if (J === 0) var e = K.return;
			else e = K, ea = $i = null, Po(e), Ra = null, za = 0, e = K;
			for (; e !== null;) Uc(e.alternate, e), e = e.return;
			K = null;
		}
	}
	function wu(e, t) {
		var n = e.timeoutHandle;
		n !== -1 && (e.timeoutHandle = -1, Jd(n)), n = e.cancelPendingCommit, n !== null && (e.cancelPendingCommit = null, n()), lu = 0, Cu(), G = e, K = n = _i(e.current, null), q = t, J = 0, Vl = null, Hl = !1, Ul = nt(e, t), Wl = !1, Zl = Xl = Yl = Jl = ql = Kl = 0, $l = Ql = null, eu = !1, t & 8 && (t |= t & 32);
		var r = e.entangledLanes;
		if (r !== 0) for (e = e.entanglements, r &= t; 0 < r;) {
			var i = 31 - qe(r), a = 1 << i;
			t |= e[i], r &= ~a;
		}
		return Gl = t, si(), n;
	}
	function Tu(e, t) {
		I = null, E.H = Vs, t === Oa || t === Aa ? (t = Ia(), J = 3) : t === ka ? (t = Ia(), J = 4) : J = t === ac ? 8 : typeof t == "object" && t && typeof t.then == "function" ? 6 : 1, Vl = t, K === null && (Kl = 1, $s(e, Ti(t, e.current)));
	}
	function Eu() {
		var e = co.current;
		return e === null ? !0 : (q & 4194048) === q ? lo === null : (q & 62914560) === q || q & 536870912 ? e === lo : !1;
	}
	function Du() {
		var e = E.H;
		return E.H = Vs, e === null ? Vs : e;
	}
	function Ou() {
		var e = E.A;
		return E.A = zl, e;
	}
	function ku() {
		Kl = 4, Hl || (q & 4194048) !== q && co.current !== null || (Ul = !0), !(ql & 134217727) && !(Jl & 134217727) || G === null || xu(G, q, Xl, !1);
	}
	function Au(e, t, n) {
		var r = W;
		W |= 2;
		var i = Du(), a = Ou();
		(G !== e || q !== t) && (iu = null, wu(e, t)), t = !1;
		var o = Kl;
		a: do
			try {
				if (J !== 0 && K !== null) {
					var s = K, c = Vl;
					switch (J) {
						case 8:
							Cu(), o = 6;
							break a;
						case 3:
						case 2:
						case 9:
						case 6:
							co.current === null && (t = !0);
							var l = J;
							if (J = 0, Vl = null, Iu(e, s, c, l), n && Ul) {
								o = 0;
								break a;
							}
							break;
						default: l = J, J = 0, Vl = null, Iu(e, s, c, l);
					}
				}
				ju(), o = Kl;
				break;
			} catch (t) {
				Tu(e, t);
			}
		while (1);
		return t && e.shellSuspendCounter++, ea = $i = null, W = r, E.H = i, E.A = a, K === null && (G = null, q = 0, si()), o;
	}
	function ju() {
		for (; K !== null;) Pu(K);
	}
	function Mu(e, t) {
		var n = W;
		W |= 2;
		var r = Du(), i = Ou();
		G !== e || q !== t ? (iu = null, ru = Fe() + 500, wu(e, t)) : Ul = nt(e, t);
		a: do
			try {
				if (J !== 0 && K !== null) {
					t = K;
					var a = Vl;
					b: switch (J) {
						case 1:
							J = 0, Vl = null, Iu(e, t, a, 1);
							break;
						case 2:
						case 9:
							if (Ma(a)) {
								J = 0, Vl = null, Fu(t);
								break;
							}
							t = function() {
								J !== 2 && J !== 9 || G !== e || (J = 7), ad(e);
							}, a.then(t, t);
							break a;
						case 3:
							J = 7;
							break a;
						case 4:
							J = 5;
							break a;
						case 7:
							Ma(a) ? (J = 0, Vl = null, Fu(t)) : (J = 0, Vl = null, Iu(e, t, a, 7));
							break;
						case 5:
							var o = null;
							switch (K.tag) {
								case 26: o = K.memoizedState;
								case 5:
								case 27:
									var c = K;
									if (o ? Wf(o) : c.stateNode.complete) {
										J = 0, Vl = null;
										var l = c.sibling;
										if (l !== null) K = l;
										else {
											var u = c.return;
											u === null ? K = null : (K = u, Lu(u));
										}
										break b;
									}
							}
							J = 0, Vl = null, Iu(e, t, a, 5);
							break;
						case 6:
							J = 0, Vl = null, Iu(e, t, a, 6);
							break;
						case 8:
							Cu(), Kl = 6;
							break a;
						default: throw Error(s(462));
					}
				}
				Nu();
				break;
			} catch (t) {
				Tu(e, t);
			}
		while (1);
		return ea = $i = null, E.H = r, E.A = i, W = n, K === null ? (G = null, q = 0, si(), Kl) : 0;
	}
	function Nu() {
		for (; K !== null && !Ne();) Pu(K);
	}
	function Pu(e) {
		var t = Pc(e.alternate, e, Gl);
		e.memoizedProps = e.pendingProps, t === null ? Lu(e) : K = t;
	}
	function Fu(e) {
		var t = e, n = t.alternate;
		switch (t.tag) {
			case 15:
			case 0:
				t = yc(n, t, t.pendingProps, t.type, void 0, q);
				break;
			case 11:
				t = yc(n, t, t.pendingProps, t.type.render, t.ref, q);
				break;
			case 5: Po(t);
			default: Uc(n, t), t = K = vi(t, Gl), t = Pc(n, t, Gl);
		}
		e.memoizedProps = e.pendingProps, t === null ? Lu(e) : K = t;
	}
	function Iu(e, t, n, r) {
		ea = $i = null, Po(t), Ra = null, za = 0;
		var i = t.return;
		try {
			if (ic(e, i, t, n, q)) {
				Kl = 1, $s(e, Ti(n, e.current)), K = null;
				return;
			}
		} catch (t) {
			if (i !== null) throw K = i, t;
			Kl = 1, $s(e, Ti(n, e.current)), K = null;
			return;
		}
		t.flags & 32768 ? (M || r === 1 ? e = !0 : Ul || q & 536870912 ? e = !1 : (Hl = e = !0, (r === 2 || r === 9 || r === 3 || r === 6) && (r = co.current, r !== null && r.tag === 13 && (r.flags |= 16384))), Ru(t, e)) : Lu(t);
	}
	function Lu(e) {
		var t = e;
		do {
			if (t.flags & 32768) {
				Ru(t, Hl);
				return;
			}
			e = t.return;
			var n = Vc(t.alternate, t, Gl);
			if (n !== null) {
				K = n;
				return;
			}
			if (t = t.sibling, t !== null) {
				K = t;
				return;
			}
			K = t = e;
		} while (t !== null);
		Kl === 0 && (Kl = 5);
	}
	function Ru(e, t) {
		do {
			var n = Hc(e.alternate, e);
			if (n !== null) {
				n.flags &= 32767, K = n;
				return;
			}
			if (n = e.return, n !== null && (n.flags |= 32768, n.subtreeFlags = 0, n.deletions = null), !t && (e = e.sibling, e !== null)) {
				K = e;
				return;
			}
			K = e = n;
		} while (e !== null);
		Kl = 6, K = null;
	}
	function zu(e, t, n, r, i, a, o, c, l) {
		e.cancelPendingCommit = null;
		do
			Wu();
		while (ou !== 0);
		if (W & 6) throw Error(s(327));
		if (t !== null) {
			if (t === e.current) throw Error(s(177));
			if (a = t.lanes | t.childLanes, a |= oi, st(e, n, a, o, c, l), e === G && (K = G = null, q = 0), cu = t, su = e, lu = n, uu = a, du = i, fu = r, t.subtreeFlags & 10256 || t.flags & 10256 ? (e.callbackNode = null, e.callbackPriority = 0, Qu(ze, function() {
				return Gu(), null;
			})) : (e.callbackNode = null, e.callbackPriority = 0), r = !!(t.flags & 13878), t.subtreeFlags & 13878 || r) {
				r = E.T, E.T = null, i = D.p, D.p = 2, o = W, W |= 4;
				try {
					sl(e, t, n);
				} finally {
					W = o, D.p = i, E.T = r;
				}
			}
			ou = 1, Bu(), Vu(), Hu();
		}
	}
	function Bu() {
		if (ou === 1) {
			ou = 0;
			var e = su, t = cu, n = !!(t.flags & 13878);
			if (t.subtreeFlags & 13878 || n) {
				n = E.T, E.T = null;
				var r = D.p;
				D.p = 2;
				var i = W;
				W |= 4;
				try {
					bl(t, e);
					var a = Bd, o = Pr(e.containerInfo), s = a.focusedElem, c = a.selectionRange;
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
					sp = !!zd, Bd = zd = null;
				} finally {
					W = i, D.p = r, E.T = n;
				}
			}
			e.current = t, ou = 2;
		}
	}
	function Vu() {
		if (ou === 2) {
			ou = 0;
			var e = su, t = cu, n = !!(t.flags & 8772);
			if (t.subtreeFlags & 8772 || n) {
				n = E.T, E.T = null;
				var r = D.p;
				D.p = 2;
				var i = W;
				W |= 4;
				try {
					cl(e, t.alternate, t);
				} finally {
					W = i, D.p = r, E.T = n;
				}
			}
			ou = 3;
		}
	}
	function Hu() {
		if (ou === 4 || ou === 3) {
			ou = 0, Pe();
			var e = su, t = cu, n = lu, r = fu;
			t.subtreeFlags & 10256 || t.flags & 10256 ? ou = 5 : (ou = 0, cu = su = null, Uu(e, e.pendingLanes));
			var i = e.pendingLanes;
			if (i === 0 && (au = null), ft(n), t = t.stateNode, Ge && typeof Ge.onCommitFiberRoot == "function") try {
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
			lu & 3 && Wu(), ad(e), i = e.pendingLanes, n & 261930 && i & 42 ? e === mu ? pu++ : (pu = 0, mu = e) : pu = 0, od(0, !1);
		}
	}
	function Uu(e, t) {
		(e.pooledCacheLanes &= t) === 0 && (t = e.pooledCache, t != null && (e.pooledCache = null, ga(t)));
	}
	function Wu() {
		return Bu(), Vu(), Hu(), Gu();
	}
	function Gu() {
		if (ou !== 5) return !1;
		var e = su, t = uu;
		uu = 0;
		var n = ft(lu), r = E.T, i = D.p;
		try {
			D.p = 32 > n ? 32 : n, E.T = null, n = du, du = null;
			var a = su, o = lu;
			if (ou = 0, cu = su = null, lu = 0, W & 6) throw Error(s(331));
			var c = W;
			if (W |= 4, U(a.current), kl(a, a.current, o, n), W = c, od(0, !1), Ge && typeof Ge.onPostCommitFiberRoot == "function") try {
				Ge.onPostCommitFiberRoot(We, a);
			} catch {}
			return !0;
		} finally {
			D.p = i, E.T = r, Uu(e, t);
		}
	}
	function Ku(e, t, n) {
		t = Ti(n, t), t = tc(e.stateNode, t, 2), e = Ya(e, t, 2), e !== null && (ot(e, 2), ad(e));
	}
	function Y(e, t, n) {
		if (e.tag === 3) Ku(e, e, n);
		else for (; t !== null;) {
			if (t.tag === 3) {
				Ku(t, e, n);
				break;
			}
			if (t.tag === 1) {
				var r = t.stateNode;
				if (typeof t.type.getDerivedStateFromError == "function" || typeof r.componentDidCatch == "function" && (au === null || !au.has(r))) {
					e = Ti(n, e), n = nc(2), r = Ya(t, n, 2), r !== null && (rc(n, r, t, e), ot(r, 2), ad(r));
					break;
				}
			}
			t = t.return;
		}
	}
	function qu(e, t, n) {
		var r = e.pingCache;
		if (r === null) {
			r = e.pingCache = new Bl();
			var i = /* @__PURE__ */ new Set();
			r.set(t, i);
		} else i = r.get(t), i === void 0 && (i = /* @__PURE__ */ new Set(), r.set(t, i));
		i.has(n) || (Wl = !0, i.add(n), e = Ju.bind(null, e, t, n), t.then(e, e));
	}
	function Ju(e, t, n) {
		var r = e.pingCache;
		r !== null && r.delete(t), e.pingedLanes |= e.suspendedLanes & n, e.warmLanes &= ~n, G === e && (q & n) === n && (Kl === 4 || Kl === 3 && (q & 62914560) === q && 300 > Fe() - tu ? !(W & 2) && wu(e, 0) : Yl |= n, Zl === q && (Zl = 0)), ad(e);
	}
	function Yu(e, t) {
		t === 0 && (t = it()), e = ui(e, t), e !== null && (ot(e, t), ad(e));
	}
	function Xu(e) {
		var t = e.memoizedState, n = 0;
		t !== null && (n = t.retryLane), Yu(e, n);
	}
	function Zu(e, t) {
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
		r !== null && r.delete(t), Yu(e, n);
	}
	function Qu(e, t) {
		return je(e, t);
	}
	var $u = null, ed = null, td = !1, nd = !1, rd = !1, id = 0;
	function ad(e) {
		e !== ed && e.next === null && (ed === null ? $u = ed = e : ed = ed.next = e), nd = !0, td || (td = !0, fd());
	}
	function od(e, t) {
		if (!rd && nd) {
			rd = !0;
			do
				for (var n = !1, r = $u; r !== null;) {
					if (!t) {
						if (e !== 0) {
							var i = r.pendingLanes;
							if (i === 0) var a = 0;
							else {
								var o = r.suspendedLanes, s = r.pingedLanes;
								a = (1 << 31 - qe(42 | e) + 1) - 1, a &= i & ~(o & ~s), a = a & 201326741 ? a & 201326741 | 1 : a ? a | 2 : 0;
							}
							a !== 0 && (n = !0, dd(r, a));
						} else a = q, a = tt(r, r === G ? a : 0, r.cancelPendingCommit !== null || r.timeoutHandle !== -1), !(a & 3) || nt(r, a) || (n = !0, dd(r, a));
					}
					r = r.next;
				}
			while (n);
			rd = !1;
		}
	}
	function sd() {
		cd();
	}
	function cd() {
		nd = td = !1;
		var e = 0;
		id !== 0 && Kd() && (e = id);
		for (var t = Fe(), n = null, r = $u; r !== null;) {
			var i = r.next, a = ld(r, t);
			a === 0 ? (r.next = null, n === null ? $u = i : n.next = i, i === null && (ed = n)) : (n = r, (e !== 0 || a & 3) && (nd = !0)), r = i;
		}
		ou !== 0 && ou !== 5 || od(e, !1), id !== 0 && (id = 0);
	}
	function ld(e, t) {
		for (var n = e.suspendedLanes, r = e.pingedLanes, i = e.expirationTimes, a = e.pendingLanes & -62914561; 0 < a;) {
			var o = 31 - qe(a), s = 1 << o, c = i[o];
			c === -1 ? ((s & n) === 0 || (s & r) !== 0) && (i[o] = rt(s, t)) : c <= t && (e.expiredLanes |= s), a &= ~s;
		}
		if (t = G, n = q, n = tt(e, e === t ? n : 0, e.cancelPendingCommit !== null || e.timeoutHandle !== -1), r = e.callbackNode, n === 0 || e === t && (J === 2 || J === 9) || e.cancelPendingCommit !== null) return r !== null && r !== null && Me(r), e.callbackNode = null, e.callbackPriority = 0;
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
			return r = ud.bind(null, e), n = je(n, r), e.callbackPriority = t, e.callbackNode = n, t;
		}
		return r !== null && r !== null && Me(r), e.callbackPriority = 2, e.callbackNode = null, 2;
	}
	function ud(e, t) {
		if (ou !== 0 && ou !== 5) return e.callbackNode = null, e.callbackPriority = 0, null;
		var n = e.callbackNode;
		if (Wu() && e.callbackNode !== n) return null;
		var r = q;
		return r = tt(e, e === G ? r : 0, e.cancelPendingCommit !== null || e.timeoutHandle !== -1), r === 0 ? null : (vu(e, r, t), ld(e, Fe()), e.callbackNode != null && e.callbackNode === n ? ud.bind(null, e) : null);
	}
	function dd(e, t) {
		if (Wu()) return null;
		vu(e, t, !0);
	}
	function fd() {
		Xd(function() {
			W & 6 ? je(Le, sd) : cd();
		});
	}
	function pd() {
		if (id === 0) {
			var e = ya;
			e === 0 && (e = Ze, Ze <<= 1, !(Ze & 261888) && (Ze = 256)), id = e;
		}
		return id;
	}
	function md(e) {
		return e == null || typeof e == "symbol" || typeof e == "boolean" ? null : typeof e == "function" ? e : ln("" + e);
	}
	function hd(e, t) {
		var n = t.ownerDocument.createElement("input");
		return n.name = t.name, n.value = t.value, e.id && n.setAttribute("form", e.id), t.parentNode.insertBefore(n, t), e = new FormData(e), n.parentNode.removeChild(n), e;
	}
	function gd(e, t, n, r, i) {
		if (t === "submit" && n && n.stateNode === i) {
			var a = md((i[_t] || null).action), o = r.submitter;
			o && (t = (t = o[_t] || null) ? md(t.formAction) : o.getAttribute("formAction"), t !== null && (a = t, o = null));
			var s = new kn("action", "action", null, r, i);
			e.push({
				event: s,
				listeners: [{
					instance: null,
					listener: function() {
						if (r.defaultPrevented) {
							if (id !== 0) {
								var e = o ? hd(i, o) : new FormData(i);
								Ds(n, {
									pending: !0,
									data: e,
									method: i.method,
									action: a
								}, null, e);
							}
						} else typeof a == "function" && (s.preventDefault(), e = o ? hd(i, o) : new FormData(i), Ds(n, {
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
	for (var _d = 0; _d < ti.length; _d++) {
		var vd = ti[_d];
		ni(vd.toLowerCase(), "on" + (vd[0].toUpperCase() + vd.slice(1)));
	}
	ni(qr, "onAnimationEnd"), ni(Jr, "onAnimationIteration"), ni(Yr, "onAnimationStart"), ni("dblclick", "onDoubleClick"), ni("focusin", "onFocus"), ni("focusout", "onBlur"), ni(Xr, "onTransitionRun"), ni(Zr, "onTransitionStart"), ni(Qr, "onTransitionCancel"), ni($r, "onTransitionEnd"), Nt("onMouseEnter", ["mouseout", "mouseover"]), Nt("onMouseLeave", ["mouseout", "mouseover"]), Nt("onPointerEnter", ["pointerout", "pointerover"]), Nt("onPointerLeave", ["pointerout", "pointerover"]), Mt("onChange", "change click focusin focusout input keydown keyup selectionchange".split(" ")), Mt("onSelect", "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" ")), Mt("onBeforeInput", [
		"compositionend",
		"keypress",
		"textInput",
		"paste"
	]), Mt("onCompositionEnd", "compositionend focusout keydown keypress keyup mousedown".split(" ")), Mt("onCompositionStart", "compositionstart focusout keydown keypress keyup mousedown".split(" ")), Mt("onCompositionUpdate", "compositionupdate focusout keydown keypress keyup mousedown".split(" "));
	var yd = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "), bd = new Set("beforetoggle cancel close invalid load scroll scrollend toggle".split(" ").concat(yd));
	function xd(e, t) {
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
	function X(e, t) {
		var n = t[yt];
		n === void 0 && (n = t[yt] = /* @__PURE__ */ new Set());
		var r = e + "__bubble";
		n.has(r) || (Td(t, e, 2, !1), n.add(r));
	}
	function Sd(e, t, n) {
		var r = 0;
		t && (r |= 4), Td(n, e, r, t);
	}
	var Cd = "_reactListening" + Math.random().toString(36).slice(2);
	function wd(e) {
		if (!e[Cd]) {
			e[Cd] = !0, At.forEach(function(t) {
				t !== "selectionchange" && (bd.has(t) || Sd(t, !1, e), Sd(t, !0, e));
			});
			var t = e.nodeType === 9 ? e : e.ownerDocument;
			t === null || t[Cd] || (t[Cd] = !0, Sd("selectionchange", !1, t));
		}
	}
	function Td(e, t, n, r) {
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
	function Ed(e, t, n, r, i) {
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
						if (h = g.stateNode, g = g.tag, g !== 5 && g !== 26 && g !== 27 || h === null || p === null || (g = gn(m, p), g != null && d.push(Dd(m, g, h))), f) break;
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
							for (d = kd, p = c, m = u, h = 0, g = p; g; g = d(g)) h++;
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
						c !== null && Ad(o, s, c, d, !1), u !== null && f !== null && Ad(o, f, u, d, !0);
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
				x && (j && n.locale !== "ko" && (sr || x !== "onCompositionStart" ? x === "onCompositionEnd" && sr && (b = Cn()) : (bn = i, xn = "value" in bn ? bn.value : bn.textContent, sr = !0)), y = Od(r, x), 0 < y.length && (x = new Vn(x, e, null, n, i), o.push({
					event: x,
					listeners: y
				}), b ? x.data = b : (b = or(n), b !== null && (x.data = b)))), (b = nr ? cr(e, n) : lr(e, n)) && (x = Od(r, "onBeforeInput"), 0 < x.length && (y = new Vn("onBeforeInput", "beforeinput", null, n, i), o.push({
					event: y,
					listeners: x
				}), y.data = b)), gd(o, e, r, n, i);
			}
			xd(o, t);
		});
	}
	function Dd(e, t, n) {
		return {
			instance: e,
			listener: t,
			currentTarget: n
		};
	}
	function Od(e, t) {
		for (var n = t + "Capture", r = []; e !== null;) {
			var i = e, a = i.stateNode;
			if (i = i.tag, i !== 5 && i !== 26 && i !== 27 || a === null || (i = gn(e, n), i != null && r.unshift(Dd(e, i, a)), i = gn(e, t), i != null && r.push(Dd(e, i, a))), e.tag === 3) return r;
			e = e.return;
		}
		return [];
	}
	function kd(e) {
		if (e === null) return null;
		do
			e = e.return;
		while (e && e.tag !== 5 && e.tag !== 27);
		return e || null;
	}
	function Ad(e, t, n, r, i) {
		for (var a = t._reactName, o = []; n !== null && n !== r;) {
			var s = n, c = s.alternate, l = s.stateNode;
			if (s = s.tag, c !== null && c === r) break;
			s !== 5 && s !== 26 && s !== 27 || l === null || (c = l, i ? (l = gn(n, a), l != null && o.unshift(Dd(n, l, c))) : i || (l = gn(n, a), l != null && o.push(Dd(n, l, c)))), n = n.return;
		}
		o.length !== 0 && e.push({
			event: t,
			listeners: o
		});
	}
	var jd = /\r\n?/g, Md = /\u0000|\uFFFD/g;
	function Nd(e) {
		return (typeof e == "string" ? e : "" + e).replace(jd, "\n").replace(Md, "");
	}
	function Pd(e, t) {
		return t = Nd(t), Nd(e) === t;
	}
	function Z(e, t, n, r, i, a) {
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
				if (typeof a == "function" && (n === "formAction" ? (t !== "input" && Z(e, t, "name", i.name, i, null), Z(e, t, "formEncType", i.formEncType, i, null), Z(e, t, "formMethod", i.formMethod, i, null), Z(e, t, "formTarget", i.formTarget, i, null)) : (Z(e, t, "encType", i.encType, i, null), Z(e, t, "method", i.method, i, null), Z(e, t, "target", i.target, i, null))), r == null || typeof r == "symbol" || typeof r == "boolean") {
					e.removeAttribute(n);
					break;
				}
				r = ln("" + r), e.setAttribute(n, r);
				break;
			case "onClick":
				r != null && (e.onclick = un);
				break;
			case "onScroll":
				r != null && X("scroll", e);
				break;
			case "onScrollEnd":
				r != null && X("scrollend", e);
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
				X("beforetoggle", e), X("toggle", e), Rt(e, "popover", r);
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
	function Fd(e, t, n, r, i, a) {
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
				r != null && X("scroll", e);
				break;
			case "onScrollEnd":
				r != null && X("scrollend", e);
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
	function Q(e, t, n) {
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
				X("error", e), X("load", e);
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
						default: Z(e, t, a, o, n, null);
					}
				}
				i && Z(e, t, "srcSet", n.srcSet, n, null), r && Z(e, t, "src", n.src, n, null);
				return;
			case "input":
				X("invalid", e);
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
						default: Z(e, t, r, d, n, null);
					}
				}
				Xt(e, a, c, l, u, o, i, !1);
				return;
			case "select":
				for (i in X("invalid", e), r = o = a = null, n) if (n.hasOwnProperty(i) && (c = n[i], c != null)) switch (i) {
					case "value":
						a = c;
						break;
					case "defaultValue":
						o = c;
						break;
					case "multiple": r = c;
					default: Z(e, t, i, c, n, null);
				}
				t = a, n = o, e.multiple = !!r, t == null ? n != null && Qt(e, !!r, n, !0) : Qt(e, !!r, t, !1);
				return;
			case "textarea":
				for (o in X("invalid", e), a = i = r = null, n) if (n.hasOwnProperty(o) && (c = n[o], c != null)) switch (o) {
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
					default: Z(e, t, o, c, n, null);
				}
				en(e, r, i, a);
				return;
			case "option":
				for (l in n) if (n.hasOwnProperty(l) && (r = n[l], r != null)) switch (l) {
					case "selected":
						e.selected = r && typeof r != "function" && typeof r != "symbol";
						break;
					default: Z(e, t, l, r, n, null);
				}
				return;
			case "dialog":
				X("beforetoggle", e), X("toggle", e), X("cancel", e), X("close", e);
				break;
			case "iframe":
			case "object":
				X("load", e);
				break;
			case "video":
			case "audio":
				for (r = 0; r < yd.length; r++) X(yd[r], e);
				break;
			case "image":
				X("error", e), X("load", e);
				break;
			case "details":
				X("toggle", e);
				break;
			case "embed":
			case "source":
			case "link": X("error", e), X("load", e);
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
					default: Z(e, t, u, r, n, null);
				}
				return;
			default: if (on(t)) {
				for (d in n) n.hasOwnProperty(d) && (r = n[d], r !== void 0 && Fd(e, t, d, r, n, void 0));
				return;
			}
		}
		for (c in n) n.hasOwnProperty(c) && (r = n[c], r != null && Z(e, t, c, r, n, null));
	}
	function Id(e, t, n, r) {
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
						default: r.hasOwnProperty(m) || Z(e, t, m, null, r, f);
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
						default: m !== f && Z(e, t, p, m, r, f);
					}
				}
				Yt(e, o, c, l, u, d, a, i);
				return;
			case "select":
				for (a in m = o = c = p = null, n) if (l = n[a], n.hasOwnProperty(a) && l != null) switch (a) {
					case "value": break;
					case "multiple": m = l;
					default: r.hasOwnProperty(a) || Z(e, t, a, null, r, l);
				}
				for (i in r) if (a = r[i], l = n[i], r.hasOwnProperty(i) && (a != null || l != null)) switch (i) {
					case "value":
						p = a;
						break;
					case "defaultValue":
						c = a;
						break;
					case "multiple": o = a;
					default: a !== l && Z(e, t, i, a, r, l);
				}
				t = c, n = o, r = m, p == null ? !!r != !!n && (t == null ? Qt(e, !!n, n ? [] : "", !1) : Qt(e, !!n, t, !0)) : Qt(e, !!n, p, !1);
				return;
			case "textarea":
				for (c in m = p = null, n) if (i = n[c], n.hasOwnProperty(c) && i != null && !r.hasOwnProperty(c)) switch (c) {
					case "value": break;
					case "children": break;
					default: Z(e, t, c, null, r, i);
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
					default: i !== a && Z(e, t, o, i, r, a);
				}
				$t(e, p, m);
				return;
			case "option":
				for (var h in n) if (p = n[h], n.hasOwnProperty(h) && p != null && !r.hasOwnProperty(h)) switch (h) {
					case "selected":
						e.selected = !1;
						break;
					default: Z(e, t, h, null, r, p);
				}
				for (l in r) if (p = r[l], m = n[l], r.hasOwnProperty(l) && p !== m && (p != null || m != null)) switch (l) {
					case "selected":
						e.selected = p && typeof p != "function" && typeof p != "symbol";
						break;
					default: Z(e, t, l, p, r, m);
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
				for (var g in n) p = n[g], n.hasOwnProperty(g) && p != null && !r.hasOwnProperty(g) && Z(e, t, g, null, r, p);
				for (u in r) if (p = r[u], m = n[u], r.hasOwnProperty(u) && p !== m && (p != null || m != null)) switch (u) {
					case "children":
					case "dangerouslySetInnerHTML":
						if (p != null) throw Error(s(137, t));
						break;
					default: Z(e, t, u, p, r, m);
				}
				return;
			default: if (on(t)) {
				for (var _ in n) p = n[_], n.hasOwnProperty(_) && p !== void 0 && !r.hasOwnProperty(_) && Fd(e, t, _, void 0, r, p);
				for (d in r) p = r[d], m = n[d], !r.hasOwnProperty(d) || p === m || p === void 0 && m === void 0 || Fd(e, t, d, p, r, m);
				return;
			}
		}
		for (var v in n) p = n[v], n.hasOwnProperty(v) && p != null && !r.hasOwnProperty(v) && Z(e, t, v, null, r, p);
		for (f in r) p = r[f], m = n[f], !r.hasOwnProperty(f) || p === m || p == null && m == null || Z(e, t, f, p, r, m);
	}
	function Ld(e) {
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
	function Rd() {
		if (typeof performance.getEntriesByType == "function") {
			for (var e = 0, t = 0, n = performance.getEntriesByType("resource"), r = 0; r < n.length; r++) {
				var i = n[r], a = i.transferSize, o = i.initiatorType, s = i.duration;
				if (a && s && Ld(o)) {
					for (o = 0, s = i.responseEnd, r += 1; r < n.length; r++) {
						var c = n[r], l = c.startTime;
						if (l > s) break;
						var u = c.transferSize, d = c.initiatorType;
						u && Ld(d) && (c = c.responseEnd, o += u * (c < s ? 1 : (s - l) / (c - l)));
					}
					if (--r, t += 8 * (a + o) / (i.duration / 1e3), e++, 10 < e) break;
				}
			}
			if (0 < e) return t / e / 1e6;
		}
		return navigator.connection && (e = navigator.connection.downlink, typeof e == "number") ? e : 5;
	}
	var zd = null, Bd = null;
	function Vd(e) {
		return e.nodeType === 9 ? e : e.ownerDocument;
	}
	function Hd(e) {
		switch (e) {
			case "http://www.w3.org/2000/svg": return 1;
			case "http://www.w3.org/1998/Math/MathML": return 2;
			default: return 0;
		}
	}
	function Ud(e, t) {
		if (e === 0) switch (t) {
			case "svg": return 1;
			case "math": return 2;
			default: return 0;
		}
		return e === 1 && t === "foreignObject" ? 0 : e;
	}
	function Wd(e, t) {
		return e === "textarea" || e === "noscript" || typeof t.children == "string" || typeof t.children == "number" || typeof t.children == "bigint" || typeof t.dangerouslySetInnerHTML == "object" && t.dangerouslySetInnerHTML !== null && t.dangerouslySetInnerHTML.__html != null;
	}
	var Gd = null;
	function Kd() {
		var e = window.event;
		return e && e.type === "popstate" ? e !== Gd && (Gd = e, !0) : (Gd = null, !1);
	}
	var qd = typeof setTimeout == "function" ? setTimeout : void 0, Jd = typeof clearTimeout == "function" ? clearTimeout : void 0, Yd = typeof Promise == "function" ? Promise : void 0, Xd = typeof queueMicrotask == "function" ? queueMicrotask : Yd === void 0 ? qd : function(e) {
		return Yd.resolve(null).then(e).catch(Zd);
	};
	function Zd(e) {
		setTimeout(function() {
			throw e;
		});
	}
	function Qd(e) {
		return e === "head";
	}
	function $d(e, t) {
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
				else if (n === "html") mf(e.ownerDocument.documentElement);
				else if (n === "head") {
					n = e.ownerDocument.head, mf(n);
					for (var a = n.firstChild; a;) {
						var o = a.nextSibling, s = a.nodeName;
						a[Ct] || s === "SCRIPT" || s === "STYLE" || s === "LINK" && a.rel.toLowerCase() === "stylesheet" || n.removeChild(a), a = o;
					}
				} else n === "body" && mf(e.ownerDocument.body);
			}
			n = i;
		} while (n);
		Np(t);
	}
	function ef(e, t) {
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
	function tf(e) {
		var t = e.firstChild;
		for (t && t.nodeType === 10 && (t = t.nextSibling); t;) {
			var n = t;
			switch (t = t.nextSibling, n.nodeName) {
				case "HTML":
				case "HEAD":
				case "BODY":
					tf(n), wt(n);
					continue;
				case "SCRIPT":
				case "STYLE": continue;
				case "LINK": if (n.rel.toLowerCase() === "stylesheet") continue;
			}
			e.removeChild(n);
		}
	}
	function nf(e, t, n, r) {
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
			if (e = lf(e.nextSibling), e === null) break;
		}
		return null;
	}
	function rf(e, t, n) {
		if (t === "") return null;
		for (; e.nodeType !== 3;) if ((e.nodeType !== 1 || e.nodeName !== "INPUT" || e.type !== "hidden") && !n || (e = lf(e.nextSibling), e === null)) return null;
		return e;
	}
	function af(e, t) {
		for (; e.nodeType !== 8;) if ((e.nodeType !== 1 || e.nodeName !== "INPUT" || e.type !== "hidden") && !t || (e = lf(e.nextSibling), e === null)) return null;
		return e;
	}
	function of(e) {
		return e.data === "$?" || e.data === "$~";
	}
	function sf(e) {
		return e.data === "$!" || e.data === "$?" && e.ownerDocument.readyState !== "loading";
	}
	function cf(e, t) {
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
	function lf(e) {
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
	var uf = null;
	function df(e) {
		e = e.nextSibling;
		for (var t = 0; e;) {
			if (e.nodeType === 8) {
				var n = e.data;
				if (n === "/$" || n === "/&") {
					if (t === 0) return lf(e.nextSibling);
					t--;
				} else n !== "$" && n !== "$!" && n !== "$?" && n !== "$~" && n !== "&" || t++;
			}
			e = e.nextSibling;
		}
		return null;
	}
	function ff(e) {
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
	function pf(e, t, n) {
		switch (t = Vd(n), e) {
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
	function mf(e) {
		for (var t = e.attributes; t.length;) e.removeAttributeNode(t[0]);
		wt(e);
	}
	var $ = /* @__PURE__ */ new Map(), hf = /* @__PURE__ */ new Set();
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
		var e = _f.f(), t = Su();
		return e || t;
	}
	function yf(e) {
		var t = Et(e);
		t !== null && t.tag === 5 && t.type === "form" ? ks(t) : _f.r(e);
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
			}, r.querySelector(i) === null && (t = r.createElement("link"), Q(t, "link", e), kt(t), r.head.appendChild(t)));
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
			$.has(a) || (e = h({
				rel: "preload",
				href: t === "image" && n && n.imageSrcSet ? void 0 : e,
				as: t
			}, n), $.set(a, e), r.querySelector(i) !== null || t === "style" && r.querySelector(jf(a)) || t === "script" && r.querySelector(Ff(a)) || (t = r.createElement("link"), Q(t, "link", e), kt(t), r.head.appendChild(t)));
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
			if (!$.has(a) && (e = h({
				rel: "modulepreload",
				href: e
			}, t), $.set(a, e), n.querySelector(i) === null)) {
				switch (r) {
					case "audioworklet":
					case "paintworklet":
					case "serviceworker":
					case "sharedworker":
					case "worker":
					case "script": if (n.querySelector(Ff(a))) return;
				}
				r = n.createElement("link"), Q(r, "link", e), kt(r), n.head.appendChild(r);
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
					}, n), (n = $.get(a)) && Rf(e, n);
					var c = o = r.createElement("link");
					kt(c), Q(c, "link", e), c._p = new Promise(function(e, t) {
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
			}, t), (t = $.get(i)) && zf(e, t), a = n.createElement("script"), kt(a), Q(a, "link", e), n.head.appendChild(a)), a = {
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
			}, t), (t = $.get(i)) && zf(e, t), a = n.createElement("script"), kt(a), Q(a, "link", e), n.head.appendChild(a)), a = {
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
					}, a.set(e, o), (a = i.querySelector(jf(e))) && !a._p && (o.instance = a, o.state.loading = 5), $.has(e) || (n = {
						rel: "preload",
						as: "style",
						href: n.href,
						crossOrigin: n.crossOrigin,
						integrity: n.integrity,
						media: n.media,
						hrefLang: n.hrefLang,
						referrerPolicy: n.referrerPolicy
					}, $.set(e, n), a || Nf(i, e, n, o.state))), t && r === null) throw Error(s(528, ""));
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
		}), Q(t, "link", n), kt(t), e.head.appendChild(t));
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
				return r = (e.ownerDocument || e).createElement("style"), kt(r), Q(r, "style", i), Lf(r, n.precedence, e), t.instance = r;
			case "stylesheet":
				i = Af(n.href);
				var a = e.querySelector(jf(i));
				if (a) return t.state.loading |= 4, t.instance = a, kt(a), a;
				r = Mf(n), (i = $.get(i)) && Rf(r, i), a = (e.ownerDocument || e).createElement("link"), kt(a);
				var o = a;
				return o._p = new Promise(function(e, t) {
					o.onload = e, o.onerror = t;
				}), Q(a, "link", r), t.state.loading |= 4, Lf(a, n.precedence, e), t.instance = a;
			case "script": return a = Pf(n.src), (i = e.querySelector(Ff(a))) ? (t.instance = i, kt(i), i) : (r = n, (i = $.get(a)) && (r = h({}, n), zf(r, i)), e = e.ownerDocument || e, i = e.createElement("script"), kt(i), Q(i, "link", r), e.head.appendChild(i), t.instance = i);
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
				a = t.ownerDocument || t, r = Mf(r), (i = $.get(i)) && Rf(r, i), a = a.createElement("link"), kt(a);
				var o = a;
				o._p = new Promise(function(e, t) {
					o.onload = e, o.onerror = t;
				}), Q(a, "link", r), n.instance = a;
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
			0 < e.imgBytes && Kf === 0 && (Kf = 62500 * Rd());
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
		i = tp(i), r.context === null ? r.context = i : r.pendingContext = i, r = Ja(t), r.payload = { element: n }, a = a === void 0 ? null : a, a !== null && (r.callback = a), n = Ya(e, r, t), n !== null && (_u(n, e, t), Xa(n, e, t));
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
			t !== null && _u(t, e, 67108864), ip(e, 67108864);
		}
	}
	function op(e) {
		if (e.tag === 13 || e.tag === 31) {
			var t = hu();
			t = dt(t);
			var n = ui(e, t);
			n !== null && _u(n, e, t), ip(e, t);
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
			if (i === null) Ed(e, t, r, fp, n), Cp(e, r);
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
									ad(a), !(W & 6) && (ru = Fe() + 500, od(0, !1));
								}
							}
							break;
						case 31:
						case 13: s = ui(a, 2), s !== null && _u(s, a, 2), Su(), ip(a, 2);
					}
					if (a = dp(r), a === null && Ed(e, t, r, fp, n), a === i) break;
					i = a;
				}
				i !== null && r.stopPropagation();
			} else Ed(e, t, r, null, n);
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
				a !== null && (e.splice(t, 3), t -= 3, Ds(a, {
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
		np(n, hu(), e, t, null, null);
	}, Ip.prototype.unmount = Fp.prototype.unmount = function() {
		var e = this._internalRoot;
		if (e !== null) {
			this._internalRoot = null;
			var t = e.containerInfo;
			np(e.current, 2, null, e, null, null), Su(), t[vt] = null;
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
		var n = !1, r = "", i = Xs, a = Zs, o = Qs;
		return t != null && (!0 === t.unstable_strictMode && (n = !0), t.identifierPrefix !== void 0 && (r = t.identifierPrefix), t.onUncaughtError !== void 0 && (i = t.onUncaughtError), t.onCaughtError !== void 0 && (a = t.onCaughtError), t.onRecoverableError !== void 0 && (o = t.onRecoverableError)), t = ep(e, 1, !1, null, null, n, r, null, i, a, o, Pp), e[vt] = t.current, wd(e), new Fp(t);
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
	return q()._blockCursorElement;
}
function ze(e) {
	return e !== null && e.nodeType === 1 && e.hasAttribute("data-lexical-slot");
}
var Be = Ce || ve || be;
function Ve() {
	let e = Dl().createElement("img");
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
		let n = this.element, r = this.before || this.getDecoratorBoundaryAnchor("trailing"), i = Dl().createElement("br");
		if (i.setAttribute("data-lexical-managed-linebreak", "true"), n.insertBefore(i, r), e) {
			let e = Dl().createElement("img");
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
	return t.type !== n.getType() && T(130, n.name), z(e) && !Array.isArray(t.children) && T(59, n.name), t;
}
function rt(e, t, n, r, i, a) {
	if (z(e)) {
		let o = e.getFirstChild();
		for (; o !== null;) {
			let e = o.__key;
			o.__parent === t && ((z(o) || Nu(o) && o.__slots !== null) && rt(o, e, n, r, i, a), n.has(e) || a.delete(e), i.push(e)), o = o.getNextSibling();
		}
	}
	for (let o of Nu(e) && e.__slots !== null ? e.__slots.values() : []) {
		let e = r.get(o);
		e !== void 0 && Pu(e) && e.__slotHost === t && ((z(e) || Nu(e) && e.__slots !== null) && rt(e, o, n, r, i, a), n.has(o) || a.delete(o), i.push(o));
	}
}
var it = !1, at = 0;
function ot(e) {
	at = e.timeStamp;
}
function st(e, t, n) {
	let r = e.nodeName === "BR", i = t.__lexicalLineBreak;
	return i && (e === i || r && e.previousSibling === i) || r && kc(e, n) !== void 0;
}
function ct(e, t, n) {
	let r = bl(ll(n)), i = r && Al(r, n._rootElement), a = null, o = null;
	i !== null && i.anchorNode === e && (a = i.anchorOffset, o = i.focusOffset);
	let s = e.nodeValue;
	s !== null && Uc(t, s, a, o, !1);
}
function lt(e, t, n) {
	if (P(e)) {
		let t = e.anchor.getNode();
		if (t.is(n) && e.format !== t.getFormat()) return !1;
	}
	return vc(t) && n.isAttached();
}
function ut(e, t, n) {
	for (let r = e; r && !$l(r); r = tl(r)) {
		let e = kc(r, t);
		if (e !== void 0) {
			let t = V(e, n);
			if (t) return B(t) || !U(r) ? void 0 : [r, t];
		}
	}
}
function dt(e, t, n) {
	it = !0;
	let r = performance.now() - at > 100;
	try {
		rs(e, () => {
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
				if (d === "characterData") r && N(h) && vc(f) && lt(i, f, h) && ct(f, h, e);
				else if (d === "childList") {
					c = !0;
					let t = u.addedNodes;
					for (let n = 0; n < t.length; n++) {
						let r = t[n], i = Dc(r), a = r.parentNode;
						if (!(a == null || r === s || i !== null || st(r, a, e) || He(r) || e._slotsUsed && U(r) && r.hasAttribute("data-lexical-slot") || $l(r))) {
							if (O) {
								let e = (U(r) ? r.innerText : null) || r.nodeValue;
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
			i !== null && (c && Fc(i), O && $c(e) && i.insertRawText(l));
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
		at === 0 && ll(e).addEventListener("textInput", ot, !0);
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
	if (Ro(), typeof n == "function") {
		let i = e.getLatest(), a = Ht(i, t);
		if (r = n(a), t.isEqual(a, r)) return i;
	} else r = n;
	let i = e.getWritable();
	return qt(i).updateFromKnown(t, r), i;
}
function Wt(e) {
	let t = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Set();
	for (let { ownNodeConfig: r } of Du(typeof e == "function" ? e : e.replace)) if (r && r.stateConfigs) for (let e of r.stateConfigs) {
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
		return e.__state ? e.__state.sharedNodeState : cc(q(), e.getType()).sharedNodeState;
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
	let n = e.mergeWithSibling(t), r = R()._normalizedNodes;
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
		if (!z(r)) break;
		e.set(r.__key, i ? r.getChildrenSize() : 0, "element", !0);
	}
}
var on = Symbol.for("@lexical/CachedTextSize");
function sn(e, t) {
	return Sn.read(() => {
		let n = 0, r = e;
		for (let e = 0; e < t && r !== null; e++) {
			let i = xn.get(r);
			if (i === void 0 && T(345, r), z(i)) {
				let a = Cn.get(r);
				if (a !== void 0 && z(a) && a.__parent !== i.__parent) n += i.getTextContentSize();
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
	z(e) || e[on] === void 0 && (e[on] = N(e) ? e.__text.length : e.getTextContentSize());
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
		if (k._keyToDOMMap.delete(e), z(n)) {
			let e = Au(n, xn);
			jn(e, 0, e.length - 1, null);
		}
		if (n !== void 0) {
			for (let e of Bn(n).values()) {
				let t = Hn(e);
				An(e, null), t !== null && t.remove();
			}
			Xc(En, dn, vn, n, "destroyed");
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
	e.style.setProperty("padding-inline-start", t === 0 ? "" : `calc(${t} * var(--lexical-indent-base-value, ${Nn}))`), Jc(e, "class"), Jc(e, "style");
}
function Fn(e, t) {
	let n = e.style;
	t === 0 ? Mn(n, "") : t === 1 ? Mn(n, "left") : t === 2 ? Mn(n, "center") : t === 3 ? Mn(n, "right") : t === 4 ? Mn(n, "justify") : t === 5 ? Mn(n, "start") : t === 6 && Mn(n, "end"), Jc(e, "style");
}
function In(e, t) {
	let n = function(e) {
		let t = e.__dir;
		if (t !== null) return t;
		if (ms(e)) return null;
		let n = e.getParent();
		return n === null || pl(n) && n.__dir === null ? "auto" : null;
	}(t);
	n === null ? e.removeAttribute("dir") : e.dir = n;
}
function Ln(e) {
	let t = Dl().createElement("div");
	return t.setAttribute("data-lexical-slot", e), t.style.display = "none", t;
}
function Rn(e, t, n) {
	t || e.contentEditable === "false" ? eu(n, k) : n.removeAttribute("contenteditable");
}
function zn(e, t, n) {
	let r = A, i = hn();
	A = "";
	let a = "", o = B(e);
	for (let [r, i] of n) {
		let n = Ln(r);
		Rn(t, o, n), t.appendChild(n), A = "";
		let s = hn();
		Wn(i, Vl(e, n, k)), gn(s), Vn(e, r, t, n), a += A;
	}
	return gn(i), A = r, a;
}
function Bn(e) {
	return Nu(e) && e.__slots !== null ? e.__slots : Mu;
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
	let a = A, o = hn(), s = "", c = null, l = B(t);
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
			n.insertBefore(o, r), Wn(a, Vl(t, o, k));
		} else i === a ? Xn(a, o) : (i !== void 0 && An(i, o), Wn(a, Vl(t, o, k)));
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
				let a = Pu(r) ? r.__slotHost : null, o = Pu(n) ? n.__slotHost : null, s = r.__parent !== n.__parent || a !== o, c = o !== null && i.parentElement !== t.element;
				if (s || c) return t.insertChild(i), Xn(e, t.element);
			}
		}
	}
	let r = Dn.$createDOM(n, k);
	if (function(e, t, n) {
		let r = n._keyToDOMMap;
		Oc(t, n, e), r.set(e, t);
	}(e, r, k), N(n) ? r.setAttribute("data-lexical-text", "true") : B(n) && (r.setAttribute("data-lexical-decorator", "true"), Ql(r, { captureSelection: !0 })), z(n)) {
		let e = n.__indent, t = n.__size;
		In(r, n), e !== 0 && Pn(r, e);
		let i = Bn(n), a = i.size > 0 ? zn(n, r, i) : "";
		if (t === 0) r.__lexicalTextContent = a, r.__lexicalFirstTextKey = null, A += a, i.size > 0 && (r.__lexicalSlotTextLength = a.length);
		else {
			let e = A, o = t - 1;
			if (Gn(Au(n, Cn), n, 0, o, Vl(n, r, k)), a !== "") {
				let t = r.__lexicalTextContent || "";
				r.__lexicalTextContent = a + t, A = e + a + t;
			}
			i.size > 0 && (r.__lexicalSlotTextLength = a.length);
		}
		let o = n.__format;
		o !== 0 && Fn(r, o), n.isInline() || (Jn(0, n, r), qn(n, r));
	} else {
		let t = n.getTextContent();
		if (B(n)) {
			let t = n.decorate(k, un);
			t !== null && Zn(e, t), r.contentEditable = "false";
			let i = Bn(n);
			i.size > 0 && zn(n, r, i);
		}
		A += t;
	}
	return t !== null && t.insertChild(r), Dn.$decorateDOM(n, null, r, k), cn(n), Xc(En, dn, vn, n, "created"), r;
}
function Gn(e, t, n, r, i) {
	let a = A, o = hn();
	A = "", fn = null, pn = null, mn = null;
	let s = n;
	for (; s <= r; ++s) {
		let t = hn();
		Wn(e[s], i);
		let n = Cn.get(e[s]);
		n !== null && N(n) ? fn === null && (fn = n.getFormat(), pn = n.getStyle(), mn = n.__key) : z(n) && s < r && !n.isInline() && (A += De), gn(t);
	}
	let c = k._keyToDOMMap.get(t.__key);
	c === void 0 && T(349, t.__key), c.__lexicalTextContent = A, c.__lexicalFirstTextKey = mn, A = a + A, gn(o);
}
function Kn(e, t) {
	if (!e) return !1;
	let n = t.get(e);
	return B(n) && !n.isInline();
}
function qn(e, t) {
	let n = Vl(e, t, k);
	n.setDecoratorBoundaryAnchor("leading", Kn(e.__first, Cn)), n.setDecoratorBoundaryAnchor("trailing", Kn(e.__last, Cn));
}
function Jn(e, t, n) {
	let r = Vl(t, n, k), i = function(e, t) {
		if (e) {
			let n = e.__last;
			if (n) {
				let e = t.get(n);
				if (e) return ws(e) ? "line-break" : B(e) && e.isInline() ? "decorator" : null;
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
	let i = On || bn.has(e) || yn.has(e), a = el(k, e);
	if (n === r && !i) {
		let e;
		if (z(n)) {
			let t = a.__lexicalTextContent;
			typeof t != "string" && T(355, n.getType()), e = t, _n(a);
		} else e = n.getTextContent();
		return A += e, a;
	}
	if (n !== r && i && Xc(En, dn, vn, r, "updated"), Dn.$updateDOM(r, n, a, k)) {
		let n = Wn(e, null);
		return t === null && T(62), t.replaceChild(n, a), An(e, null), n;
	}
	if (z(n)) {
		z(r) || T(334, e);
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
										if (z(e)) {
											let r = k._keyToDOMMap.get(n), i = r && r.__lexicalTextContent;
											typeof i != "string" && T(352, e.getType()), t = i;
										} else t = e.getTextContent();
										d += t, c < u - 1 && z(e) && !e.isInline() && (d += De), n = e.__next, c++;
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
										if (z(t)) {
											let r = k._keyToDOMMap.get(f[e]), i = r && r.__lexicalTextContent;
											typeof i != "string" && T(350, t.getType()), n = i;
										} else n = t.getTextContent();
										x += n, e < o - 1 && z(t) && !t.isInline() && (x += De);
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
									if (z(e)) {
										r = wn.get(t);
										let i = r && r.__lexicalTextContent;
										typeof i != "string" && T(354, e.getType()), n = i;
									} else n = e.getTextContent();
									A += n, r !== void 0 && _n(r);
								}
								N(e) ? fn === null && (fn = e.getFormat(), pn = e.getStyle(), mn = e.__key) : z(e) && n < a - 1 && !e.isInline() && (A += De), gn(i), t = e.__next, n++;
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
						let r = Au(e, xn), s = Au(t, Cn);
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
										let e = el(k, r);
										e !== u && a.withBefore(u ?? a.before).insertChild(e), u = Qn(Xn(r, a.element)), d++, f++;
									} else Wn(r, a.withBefore(u ?? a.before)), f++;
								}
								let o = Cn.get(r);
								o !== null && N(o) ? fn === null && (fn = o.getFormat(), pn = o.getStyle(), mn = o.__key) : z(o) && f <= s && !o.isInline() && (A += De), gn(i);
							}
							let p = d > o, m = f > s;
							if (p && !m) {
								let t = n[s + 1], r = t === void 0 ? null : k.getElementByKey(t);
								Gn(n, e, f, s, a.withBefore(r ?? a.before));
							} else m && !p && jn(t, d, o, a.element);
						})(t, r, s, i, a, n);
					}
					s.__lexicalTextContent = A, s.__lexicalFirstTextKey = mn, A = r + A;
				}(e, t, Vl(t, n, k)), pl(t) || (r = t, fn == null || fn === r.__textFormat || kn || r.setTextFormat(fn), function(e) {
					pn == null || pn === e.__textStyle || kn || e.setTextStyle(pn);
				}(t));
			}(n, r, a), r.isInline() || (ms(r) || Jn(0, r, a), qn(r, a)), s !== "") {
				let t = a.__lexicalTextContent || "";
				a.__lexicalTextContent = s + t, A = e + s + t, a.__lexicalSlotTextLength = s.length;
			} else (Bn(r).size > 0 || Bn(n).size > 0) && (a.__lexicalSlotTextLength = 0);
		} else {
			let e = a.__lexicalTextContent;
			typeof e != "string" && T(356, n.getType()), A += e, _n(a);
		}
		if ((On || r.__dir !== n.__dir || r.__parent !== n.__parent) && (In(a, r), ms(r) && !On)) for (let e of r.getChildren()) z(e) && In(el(k, e.getKey()), e);
	} else {
		let t = r.getTextContent();
		if (B(r)) {
			let t = r.decorate(k, un);
			t !== null && Zn(e, t), i && (Bn(r).size > 0 || Bn(n).size > 0) && Un(n, r, a);
		}
		A += t;
	}
	if (!kn && ms(r)) {
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
		n = jc(k);
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
	A = "", fn = null, pn = null, mn = null, On = r === 2, k = n, un = n._config, Dn = n._config.dom || $s, dn = n._nodes, vn = k._listeners.mutation, yn = i, bn = a, xn = e._nodeMap, Sn = e, Cn = t._nodeMap, kn = t._readOnly, wn = Ze(n._keyToDOMMap), Tn = function() {
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
	return En = o, Xn("root", null), k = void 0, dn = void 0, yn = void 0, bn = void 0, xn = void 0, Sn = void 0, Cn = void 0, un = void 0, wn = void 0, Tn = void 0, En = void 0, Dn = $s, o;
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
	let o = e.anchor, s = e.focus, c = o.getNode(), l = R(), u;
	if (a !== void 0) u = a;
	else {
		let e = bl(ll(l));
		u = e === null ? null : Al(e, l._rootElement);
	}
	let d = u === null ? null : u.anchorNode, f = o.key, p = l.getElementByKey(f), m = n.length;
	return f !== s.key || !N(c) || (!i && (!ge || l._inputState.lastBeforeInputInsertTextTimeStamp < r + 50) || c.isDirty() && m < 2 || Rc(n)) && o.offset !== s.offset && !c.isComposing() || _c(c) || c.isDirty() && m > 1 || (i || !ge) && p !== null && !c.isComposing() && d !== Ul(c, p, l) || u !== null && t !== null && (!t.collapsed || t.startContainer !== u.anchorNode || t.startOffset !== u.anchorOffset) || !c.isComposing() && (c.getFormat() !== e.format || c.getStyle() !== e.style) || function(e, t) {
		if (t.isSegmented()) return !0;
		if (!e.isCollapsed()) return !1;
		let n = e.anchor.offset, r = t.getParentOrThrow(), i = gc(t);
		return n === 0 ? !t.canInsertTextBefore() || !r.canInsertTextBefore() && !t.isComposing() || i || function(e) {
			let t = e.getPreviousSibling();
			return (N(t) || z(t) && t.isInline()) && !t.canInsertTextAfter();
		}(t) : n === t.getTextContentSize() && (!t.canInsertTextAfter() || !r.canInsertTextAfter() && !t.isComposing() || i);
	}(e, c);
}
function ci(e, t) {
	return vc(e) && e.nodeValue !== null && t !== 0 && t !== e.nodeValue.length;
}
function li(e, t, n) {
	let { anchorNode: r, anchorOffset: i, focusNode: a, focusOffset: o } = Al(e, t._rootElement), s = t._inputState;
	if (s.isSelectionChangeFromDOMUpdate) {
		s.isSelectionChangeFromDOMUpdate = !1;
		let e = s.selectionChangeFromDOMUpdatePoints;
		if (s.selectionChangeFromDOMUpdatePoints = null, ci(r, i) && ci(a, o) && !s.postDeleteSelectionToRestore && (e === null || e.anchorNode === r && e.anchorOffset === i && e.focusNode === a && e.focusOffset === o)) return;
	}
	rs(t, () => {
		if (!n) return void Fc(null);
		if (!fc(t, r, a)) return;
		let c = F();
		if (s.postDeleteSelectionToRestore && P(c) && c.isCollapsed()) {
			let e = c.anchor, t = s.postDeleteSelectionToRestore.anchor;
			(e.key === t.key && e.offset === t.offset + 1 || e.offset === 1 && t.getNode().is(e.getNode().getPreviousSibling())) && (c = s.postDeleteSelectionToRestore.clone(), Fc(c));
		}
		if (s.postDeleteSelectionToRestore = null, P(c)) {
			let n = c.anchor, l = n.getNode();
			if (c.isCollapsed()) {
				e.type === "Range" && r === a && (c.dirty = !0);
				let i = ll(t).event, o = i ? i.timeStamp : performance.now(), { format: u, style: d, offset: f, key: p, timeStamp: m } = s.collapsedSelectionFormat, h = Nc(), g = !1 === t.isComposing() && h.getTextContent() === "";
				if (o < m + 200 && n.offset === f && n.key === p) ui(c, u, d);
				else if (n.type === "text") N(l) || T(141), di(c, l);
				else if (n.type === "element" && !g) {
					z(l) || T(259);
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
			(n || Qo(e, t)) && e.dispatchCommand(rr);
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
	rs(t, () => {
		let n = F(), r = bl(ll(t)), i = po();
		if (r) {
			if (P(n)) {
				let e = n.anchor, t = e.getNode();
				e.type === "element" && e.offset === 0 && n.isCollapsed() && !ms(t) && Nc().getChildrenSize() === 1 && t.getTopLevelElementOrThrow().isEmpty() && i !== null && n.is(i) && (r.removeAllRanges(), n.dirty = !0);
			} else if (e.pointerType === "touch" || e.pointerType === "pen") {
				let n = Al(r, t._rootElement).anchorNode;
				(U(n) || vc(n)) && Fc(fo(i, r, t, e));
			}
		}
		if (O && r !== null && r.rangeCount === 0) {
			let n = t._rootElement;
			if (n !== null && e.target === n) {
				let a = e.clientY, o = n.childNodes.length;
				for (let e = 0; e < n.childNodes.length; e++) {
					let t = n.childNodes[e];
					if (U(t)) {
						let n = t.getBoundingClientRect();
						if (a <= (n.top + n.bottom) / 2) {
							o = e;
							break;
						}
					}
				}
				r.setBaseAndExtent(n, o, n, o);
				let s = fo(i, r, t, e);
				s === null ? r.removeAllRanges() : Fc(s);
			}
		}
		H(t, ir, e);
	});
}
function pi(e, t) {
	let n = Il(e), r = e.pointerType;
	Ll(n) && r !== "touch" && r !== "pen" && e.button === 0 && rs(t, () => {
		tu(n, t) || (t._inputState.isSelectionChangeFromMouseDown = !0);
	});
}
function mi(e) {
	if (!e.getTargetRanges) return null;
	let t = e.getTargetRanges();
	return t.length === 0 ? null : t[0];
}
function hi(e) {
	let { lastKeyCode: t } = R()._inputState;
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
			if (ws(e)) e.selectEnd();
			else if (!e) {
				let e = ku(i, so), t = e && e.getNextSibling();
				z(t) && t.selectStart();
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
	let n = Il(e);
	if (U(n) && tu(n, t)) return !0;
	let r = t.getRootElement();
	if (r === null) return !1;
	let i = Fl(r.ownerDocument);
	return i !== null && r.contains(i) && tu(i, t);
}
function yi(e) {
	let t = e.inputType, n = mi(e), r = R(), i = r._inputState, a = F();
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
			Fc(e.clone());
		}
		if (P(a)) {
			let t = a.anchor.key === a.focus.key;
			if (function(e, t) {
				return e.lastKeyCode === "MediaLast" && t < e.lastKeyDownTimeStamp + 30;
			}(i, e.timeStamp) && r.isComposing() && t) {
				if (Tc(null), i.lastKeyDownTimeStamp = 0, setTimeout(() => {
					rs(r, () => {
						Tc(null);
					});
				}, 30), P(a)) {
					let e = a.anchor.getNode();
					e.markDirty(), N(e) || T(142), di(a, e);
				}
			} else {
				if (Tc(null), ve && n !== null && !n.collapsed && (a.applyDOMRange(n), !a.isCollapsed())) return e.preventDefault(), a.removeText(), !0;
				e.preventDefault();
				let o = a.anchor.getNode(), s = o.getTextContent(), c = o.canInsertTextAfter(), l = a.anchor.offset === 0 && a.focus.offset === s.length, u = Se && t && !l && c;
				if (u && a.isCollapsed() && (u = !B(Qc(a.anchor, !0))), !u) {
					H(r, lr, !0);
					let e = F();
					Se && P(e) && e.isCollapsed() && (i.postDeleteSelectionToRestore = e, setTimeout(() => i.postDeleteSelectionToRestore = null));
				}
			}
			return !0;
		}
	}
	if (!P(a)) return t !== "historyUndo" && t !== "historyRedo" || (e.preventDefault(), H(r, t === "historyUndo" ? vr : yr)), !0;
	let o = e.data;
	i.unprocessedBeforeInputData !== null && Hc(!1, r, i.unprocessedBeforeInputData), a.dirty && i.unprocessedBeforeInputData === null || !a.isCollapsed() || ms(a.anchor.getNode()) || n === null || a.applyDOMRange(n), i.unprocessedBeforeInputData = null;
	let s = a.anchor, c = a.focus, l = s.getNode(), u = c.getNode();
	if (t === "insertText" || t === "insertTranspose") {
		if (o === "\n") e.preventDefault(), H(r, ur, !1);
		else if (o === De) e.preventDefault(), H(r, dr);
		else if (o == null && e.dataTransfer) {
			let t = e.dataTransfer.getData("text/plain");
			e.preventDefault(), a.insertRawText(t);
		} else o != null && si(a, n, o, e.timeStamp, !0) ? (e.preventDefault(), H(r, fr, o), hi(o)) : i.unprocessedBeforeInputData = o;
		return i.lastBeforeInputInsertTextTimeStamp = e.timeStamp, !0;
	}
	switch (e.preventDefault(), t) {
		case "insertFromYank":
		case "insertFromDrop":
		case "insertReplacementText":
			H(r, fr, e), hi((e.dataTransfer ? e.dataTransfer.getData("text/plain") : null) ?? e.data);
			break;
		case "insertFromComposition": {
			let t = i.hadOrphanedCompositionEvents;
			i.hadOrphanedCompositionEvents = !1;
			let n = r._compositionKey;
			Tc(null), t || H(r, fr, e), Ti(n);
			break;
		}
		case "insertLineBreak":
			Tc(null), i.isInsertLineBreak = !1, H(r, ur, !1);
			break;
		case "insertParagraph":
			Tc(null), i.isInsertLineBreak ? (i.isInsertLineBreak = !1, H(r, ur, !1)) : H(r, dr);
			break;
		case "insertFromPaste":
		case "insertFromPasteAsQuotation":
			H(r, pr, e);
			break;
		case "deleteByComposition":
			(function(e, t) {
				return e !== t || z(e) || z(t) || !gc(e) || !gc(t);
			})(l, u) && H(r, mr, e);
			break;
		case "deleteByDrag":
			al(Xi), H(r, mr, e);
			break;
		case "deleteByCut":
			H(r, mr, e);
			break;
		case "deleteContent":
			H(r, lr, !1);
			break;
		case "deleteWordBackward":
			H(r, hr, !0);
			break;
		case "deleteWordForward":
			H(r, hr, !1);
			break;
		case "deleteHardLineBackward":
		case "deleteSoftLineBackward":
			H(r, gr, !0);
			break;
		case "deleteContentForward":
		case "deleteHardLineForward":
		case "deleteSoftLineForward":
			H(r, gr, !1);
			break;
		case "formatStrikeThrough":
			H(r, _r, "strikethrough");
			break;
		case "formatBold":
			H(r, _r, "bold");
			break;
		case "formatItalic":
			H(r, _r, "italic");
			break;
		case "formatUnderline":
			H(r, _r, "underline");
			break;
		case "historyUndo":
			H(r, vr);
			break;
		case "historyRedo": H(r, yr);
	}
	return !0;
}
function bi(e, t) {
	e.stopPropagation();
	let n = t._inputState;
	gi(n), rs(t, () => {
		vi(e, t) || t.dispatchCommand(or, e);
	}, { event: e }), n.unprocessedBeforeInputData = null;
}
function xi(e) {
	let t = R(), n = t._inputState, r = F(), i = e.data, a = mi(e), o = !1;
	if (i != null && P(r)) {
		let s = bl(ll(t)), c = s === null ? null : Al(s, t._rootElement), l = e.inputType === "insertCompositionText" && n.compositionPhase !== "ending-firefox" && !t.isComposing();
		l && (n.hadOrphanedCompositionEvents = !0);
		let u = r.anchor.getNode(), d = e.inputType === "insertCompositionText" && n.compositionPhase !== "ending-firefox" && t.isComposing() && N(u) && _c(u);
		if (!l && !d && si(r, a, i, e.timeStamp, !1, c)) {
			if (o = !0, n.compositionPhase === "ending-firefox") {
				let e = Ei(t, i);
				if (n.compositionPhase = "idle", e) return al(Zi), Ic(), !0;
			}
			let a = r.anchor.getNode();
			if (s === null || c === null) return !0;
			let l = r.isBackward(), u = l ? r.anchor.offset : r.focus.offset, d = l ? r.focus.offset : r.anchor.offset;
			ge && !r.isCollapsed() && N(a) && c.anchorNode !== null && a.getTextContent().slice(0, u) + i + a.getTextContent().slice(u + d) === Vc(c.anchorNode) || H(t, fr, i);
			let f = i.length;
			O && f > 1 && e.inputType === "insertCompositionText" && !t.isComposing() && (r.anchor.offset -= f, r._cachedNodes = null, r._cachedIsBackward = null), Se && t.isComposing() && (n.lastKeyDownTimeStamp = 0, Tc(null));
		}
	}
	return o || (Hc(!1, t, i === null ? void 0 : i), n.compositionPhase === "ending-firefox" && (Ei(t, i || void 0), al("composition-end"), n.compositionPhase = "idle")), Ic(), !0;
}
function Si(e, t) {
	H(t, sr, e);
}
function Ci(e) {
	let t = R(), n = t._inputState, r = F();
	if (P(r) && !t.isComposing()) {
		n.compositionPhase = "composing", n.hadOrphanedCompositionEvents = !1;
		let i = r.anchor, a = r.anchor.getNode();
		if (Tc(i.key), al("composition-start"), e.timeStamp < n.lastKeyDownTimeStamp + 30 || i.type === "element" || !r.isCollapsed() || !Se && (a.getFormat() !== r.format || N(a) && a.getStyle() !== r.style) || N(a) && (_c(a) || i.offset === 0 && !a.canInsertTextBefore() || i.offset === a.getTextContentSize() && !a.canInsertTextAfter())) {
			H(t, fr, Oe);
			let e = F();
			P(e) && Tc(e.anchor.key);
		}
	}
	return !0;
}
function wi(e) {
	let t = R();
	return t._inputState.compositionPhase = "idle", Ei(t, e.data), al(Zi), !0;
}
function Ti(e) {
	if (e === null) return;
	let t = V(e);
	if (!N(t) || t.getType() === "text" || _c(t) || !t.isAttached()) return;
	let n = F(), r = P(n) && n.anchor.key === e ? n.anchor.offset : null, i = Da(t.getTextContent());
	if (i.setFormat(t.getFormat()), i.setStyle(t.getStyle()), t.replace(i), r !== null) {
		let e = Math.min(r, i.getTextContentSize());
		i.select(e, e);
	}
}
function Ei(e, t) {
	let n = e._compositionKey;
	if (Tc(null), n !== null && t != null) {
		if (t === "") {
			let t = V(n), r = e.getElementByKey(n), i = r !== null && N(t) ? Ul(t, r, e) : null;
			if (i !== null && i.nodeValue !== null && N(t)) {
				let n = bl(ll(e)), r = n && Al(n, e._rootElement), a = null, o = null;
				r !== null && r.anchorNode === i && (a = r.anchorOffset, o = r.focusOffset), Uc(t, i.nodeValue, a, o, !0);
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
				return H(e, Dr, null), Ti(n), !1;
			}
		}
		let r = V(n);
		if (r !== null && N(r) && _c(r)) {
			r.markDirty();
			let e = F(), i = r.getTextContentSize(), a = P(e) && e.anchor.key === n ? e.anchor.offset : i;
			return r.select(a, a).insertText(t), !0;
		}
	}
	return Hc(!0, e, t), Ti(n), !1;
}
function Di(e, t) {
	let n = t._inputState;
	O ? n.compositionPhase = "ending-firefox" : ve || !be && !Ce ? H(t, cr, e) : (n.compositionPhase = "ending-safari", n.compositionEndData = e.data);
}
function Oi(e, t) {
	let n = t._inputState;
	ve && (n.isShiftKeyDown = e.key === "Shift" || n.isShiftKeyDown && e.shiftKey && e.key !== "CapsLock"), n.lastKeyDownTimeStamp = e.timeStamp, n.lastKeyCode = e.key, e.key !== "Backspace" && gi(n), t.isComposing() || H(t, br, e);
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
	let t = R(), n = t._inputState;
	if (e.key == null) return !0;
	if (n.compositionPhase === "ending-safari") {
		let r = function(e) {
			return e.key === "Backspace";
		}(e);
		if (r && rs(t, () => {
			Ei(t, n.compositionEndData);
		}), n.compositionPhase = "idle", n.compositionEndData = "", r) return !0;
	}
	let r = t._keyDownShortcuts;
	r === null && (r = $r(function() {
		let e = (e, t, n) => ({
			key: e,
			modifiers: t,
			onMatch: (e, t) => {
				H(t, n, e);
			}
		}), t = (e, t, n, r) => ({
			key: e,
			modifiers: t,
			onMatch: (e, t) => {
				e.preventDefault(), H(t, n, r);
			}
		}), n = (e, t) => ({
			key: "Enter",
			modifiers: e,
			onMatch: (e, n) => {
				let r = n._inputState;
				r.isInsertLineBreak = t && (!ve || r.isShiftKeyDown), H(n, Dr, e), e.defaultPrevented && (r.isInsertLineBreak = !1);
			}
		}), r = (e, t) => ({
			key: e,
			modifiers: Jr,
			onMatch: (e, n) => {
				let r = n._editorState._selection;
				r === null || P(r) || (e.preventDefault(), H(n, t, e));
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
					H(t, kr, e) && _i(t._inputState);
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
						e.preventDefault(), H(t, ur, !0);
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
					e.preventDefault(), H(t, zr, e) && _i(t._inputState);
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
	let t = xl(e.target);
	if (t === null) return;
	let n = nl(e.target), r = null, i = null, a = n === null ? void 0 : ai.get(n);
	if (n !== null) {
		if (a !== void 0) {
			let e = a.editors, n = a.hasShadowEditor;
			if (n === void 0) {
				n = !1;
				for (let t of e) if (t._rootElement !== null && Sl(t._rootElement.getRootNode())) {
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
					let s = Al(t, e).anchorNode;
					if (s !== null && mc(s) === o) {
						if (Sl(e.getRootNode())) {
							r = o, i = s;
							break;
						}
						n === null && (n = o, a = s);
					}
				}
				r === null && n !== null && (r = n, i = a);
			} else {
				let e = t.anchorNode;
				e === null || U(e) && e.shadowRoot !== null || (r = mc(e), r !== null && (i = e));
			}
		}
		if (r === null) {
			let e = Fl(n);
			r = e === null ? null : mc(e);
		}
	}
	if (r === null) return;
	if (r._inputState.isSelectionChangeFromMouseDown) {
		if (a !== void 0) for (let e of a.editors) e._inputState.isSelectionChangeFromMouseDown = !1;
		rs(r, () => {
			let n = po(), a = i ?? Al(t, r._rootElement).anchorNode;
			(U(a) || vc(a)) && Fc(fo(n, t, r, e));
		});
	}
	let o = zc(r), s = o[o.length - 1], c = s._key, l = Ii.get(c), u = l || s;
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
	Ro();
	let r = e.__key, i = e.getParent();
	if (i === null) return void (Fu(e) !== null && T(367, r, String(Fu(e))));
	let a = function(e) {
		let t = F();
		if (!P(t) || !z(e)) return t;
		let { anchor: n, focus: r } = t, i = n.getNode(), a = r.getNode();
		return sl(i, e) && n.set(e.__key, 0, "element"), sl(a, e) && r.set(e.__key, 0, "element"), t;
	}(e), o = !1;
	if (P(a) && t) {
		let t = a.anchor, n = a.focus;
		t.key === r && (_o(t, e, i, e.getPreviousSibling(), e.getNextSibling()), o = !0), n.key === r && (_o(n, e, i, e.getPreviousSibling(), e.getNextSibling()), o = !0);
	} else Ha(a) && t && e.isSelected() && e.selectPrevious();
	if (P(a) && t && !o && mo(a, i)) {
		let t = e.getIndexWithinParent();
		Cc(e), ho(a, i, t, -1);
	} else Cc(e);
	n || pl(i) || i.canBeEmpty() || !i.isEmpty() || Vi(i, t), t && a && ms(i) && i.isEmpty() && i.selectEnd();
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
		let { ownNodeType: e } = Su(this);
		return e === void 0 && T(64, this.name), e;
	}
	static clone(e) {
		T(65, this.name);
	}
	$config() {
		return {};
	}
	config(e, t) {
		let n = t.extends || ju(this.constructor);
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
		this.__type = this.constructor.getType(), this.__parent = null, this.__prev = null, this.__next = null, Object.defineProperty(this, "__state", Ui), Object.defineProperty(this, on, Ui), Sc(this, e);
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
			let t = V(e);
			if (t === null) break;
			e = t.__parent === null ? Fu(t) : t.__parent;
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
			if (B(this) && this.isInline() && e) {
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
		return e === null ? null : V(e);
	}
	getParentOrThrow() {
		let e = this.getParent();
		return e === null && T(66, this.__key), e;
	}
	getTopLevelElement() {
		let e = this;
		for (; e !== null;) {
			let t = e.getParent();
			if (pl(t) || Fu(e) !== null) return z(e) || e === this && B(e) || T(194), e;
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
		return e === null ? null : V(e);
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
		return e === null ? null : V(e);
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
		let t = kd(this, e);
		return t !== null && (t.type === "descendant" || (t.type === "branch" ? Ed(t) === -1 : (t.type !== "same" && t.type !== "ancestor" && T(279), !1)));
	}
	isParentOf(e) {
		return sl(e, this);
	}
	getNodesBetween(e) {
		let t = this.isBefore(e), n = [], r = /* @__PURE__ */ new Set(), i = this;
		for (; i !== null;) {
			let a = i.__key;
			if (r.has(a) || (r.add(a), n.push(i)), i === e) break;
			let o = z(i) ? t ? i.getFirstChild() : i.getLastChild() : null;
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
		let e = R()._dirtyLeaves;
		return e !== null && e.has(this.__key);
	}
	getLatest() {
		if (Hi(this)) return this;
		let e = V(this.__key);
		return e === null && T(113), e;
	}
	getWritable() {
		if (Hi(this)) return this;
		Ro();
		let e = Bo(), t = R(), n = this.__key, r = t._cloneNotNeeded, i = r.get(n), a = e._selection;
		if (a !== null && a.setCachedNodes(null), i !== void 0) return wc(i), i;
		let o = e._nodeMap, s = o.get(n);
		s === void 0 && T(113);
		let c = ql(s);
		return r.set(n, c), o.set(n, c), wc(c), c;
	}
	getTextContent() {
		return Ju(this);
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
		return { element: J(e).$createDOM(this, e) };
	}
	exportJSON(e = !1) {
		let t = function(e, t) {
			let n = au(iu(e.constructor)), { generated: r, isCompactDefault: i } = n, a = r === null ? void 0 : t ? r.exportCompactJSON : r.exportJSON;
			return a === void 0 ? function(e, t, n) {
				let r = n ? { type: e.__type } : {};
				return z(e) && (r.children = []), function(e, t, n, r) {
					for (let i = 0; i < t.length; i++) {
						let a = t[i];
						if (r && a.derived) continue;
						let o;
						if (a.kind === "ownField") {
							let t = _u(e)[a.field];
							o = a.getterTable === void 0 ? t : kt(a.getterTable, t) ? a.getterTable[t] : void 0;
						} else o = a.getter.call(e);
						a.kind === "ownField" && a.when !== void 0 && (!vu(a, o) && a.when.call(e) || (o = void 0)), r && vu(a, o) || (n[a.key] = o);
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
		return xu(Jt(this, e), e);
	}
	static transform() {
		return null;
	}
	remove(e) {
		Vi(this, !0, e);
	}
	replace(e, t) {
		Ro();
		let n = F();
		n !== null && (n = n.clone()), gl(this, e);
		let r = this.getLatest(), i = this.__key, a = Iu(r);
		a !== null && T(400, i, r.getType(), a.getKey(), a.getType());
		let o = e.__key, s = e.getWritable(), c = this.getParentOrThrow().getWritable(), l = c.__size, u = s.getParent(), d = u !== null && P(n) && mo(n, u), f = d ? s.getIndexWithinParent() : -1;
		Cc(s), d && u !== null && P(n) && ho(n, u, f, -1);
		let p = r.getPreviousSibling(), m = r.getNextSibling(), h = r.__prev, g = r.__next, _ = r.__parent;
		Vi(r, !1, !0), p === null ? c.__first = o : p.getWritable().__next = o, s.__prev = h, m === null ? c.__last = o : m.getWritable().__prev = o, s.__next = g, s.__parent = _, c.__size = u !== null && u.is(c) ? l - 1 : l;
		let v = 0;
		if (t && (z(this) && z(s) || T(139), v = s.getChildrenSize(), s.splice(v, 0, this.getChildren())), P(n)) {
			Fc(n);
			let e = n.anchor, r = n.focus;
			e.key === i && (t && e.type === "element" ? e.set(s.__key, v + e.offset, "element") : Ia(e, s)), r.key === i && (t && r.type === "element" ? r.set(s.__key, v + r.offset, "element") : Ia(r, s));
		}
		return Ec() === i && Tc(o), s;
	}
	insertAfter(e, t = !0) {
		Ro(), gl(this, e);
		let n = this.getWritable(), r = e.getWritable();
		this.getParentOrThrow();
		let i = r.getParent(), a = F(), o = !1, s = !1, c = -1;
		if (i !== null && t && P(a) && mo(a, i)) {
			let t = i.__key, n = a.anchor, r = a.focus;
			c = e.getIndexWithinParent(), o = n.type === "element" && n.key === t && n.offset === c + 1, s = r.type === "element" && r.key === t && r.offset === c + 1;
		}
		Cc(r), c !== -1 && i !== null && P(a) && ho(a, i, c, -1);
		let l = this.getNextSibling(), u = this.getParentOrThrow().getWritable(), d = r.__key, f = n.__next;
		if (l === null ? u.__last = d : l.getWritable().__prev = d, u.__size++, n.__next = d, r.__next = f, r.__prev = n.__key, r.__parent = n.__parent, t && P(a)) {
			let e = u.__key;
			if (o || s || mo(a, u)) {
				let t = this.getIndexWithinParent();
				ho(a, u, t + 1), o && a.anchor.set(e, t + 2, "element"), s && a.focus.set(e, t + 2, "element");
			}
		}
		return e;
	}
	insertBefore(e, t = !0) {
		Ro(), gl(this, e);
		let n = this.getWritable(), r = e.getWritable();
		this.getParentOrThrow();
		let i = r.__key, a = F(), o = r.getParent(), s = o !== null && t && P(a) && mo(a, o), c = s ? r.getIndexWithinParent() : -1;
		Cc(r), s && o !== null && P(a) && ho(a, o, c, -1);
		let l = this.getPreviousSibling(), u = this.getParentOrThrow().getWritable(), d = n.__prev, f = t && P(a) && mo(a, u), p = f ? this.getIndexWithinParent() : -1;
		return l === null ? u.__first = i : l.getWritable().__next = i, u.__size++, n.__prev = i, r.__prev = d, r.__next = n.__key, r.__parent = n.__parent, f && P(a) && ho(a, u, p), e;
	}
	isParentRequired() {
		return !1;
	}
	createParentElementNode() {
		return Js();
	}
	selectStart() {
		return this.selectPrevious();
	}
	selectEnd() {
		return this.selectNext(0, 0);
	}
	selectPrevious(e, t) {
		Ro();
		let n = Iu(this);
		if (n !== null) return n.selectPrevious(e, t);
		let r = this.getPreviousSibling(), i = this.getParentOrThrow();
		if (r === null) return i.select(0, 0);
		if (z(r)) return r.select();
		if (!N(r)) {
			let e = r.getIndexWithinParent() + 1;
			return i.select(e, e);
		}
		return r.select(e, t);
	}
	selectNext(e, t) {
		Ro();
		let n = Iu(this);
		if (n !== null) return n.selectNext(e, t);
		let r = this.getNextSibling(), i = this.getParentOrThrow();
		if (r === null) return i.select();
		if (z(r)) return r.select(0, 0);
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
	let a = r.classList, o = Yc(i, "base");
	o !== void 0 && a.add(...o), o = Yc(i, "underlineStrikethrough");
	let s = !1, c = 8 & t && 4 & t;
	o !== void 0 && (8 & n && 4 & n ? (s = !0, c || a.add(...o)) : c && a.remove(...o));
	for (let e in ke) {
		let r = ke[e];
		if (o = Yc(i, e), o !== void 0) {
			if (n & r) {
				if (s && (e === "underline" || e === "strikethrough")) {
					t & r && a.remove(...o);
					continue;
				}
				((t & r) === 0 || c && e === "underline" || e === "strikethrough") && a.add(...o);
			} else t & r && a.remove(...o);
		}
	}
	Jc(r, "class");
}
function ma(e, t, n) {
	let r = n.isComposing(), i = e + (r ? Ee : ""), a = q(), o = J(a).$getDOMSlot(n, t, a), s = o.getFirstChild();
	if (s === null || s.nodeType !== Node.TEXT_NODE) return void o.insertChild(Dl().createTextNode(i));
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
	let n = Dl().createElement(t);
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
		return this.__key === Ec();
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
		return xc(this.getLatest().__format, e, t);
	}
	canHaveFormat() {
		return !0;
	}
	isInline() {
		return !0;
	}
	createDOM(e, t) {
		let n = this.__format, r = da(0, n), i = fa(0, n), a = r === null ? i : r, o = Dl().createElement(a), s = o;
		this.hasFormat("code") && o.setAttribute("spellcheck", "false"), r !== null && (s = Dl().createElement(i), o.appendChild(s)), ha(s, this, 0, n, this.__text, e);
		let c = this.__style;
		return c !== "" && la(o.style, c), o;
	}
	updateDOM(e, t, n) {
		let r = this.__text, i = e.__format, a = this.__format, o = da(0, i), s = da(0, a), c = fa(0, i), l = fa(0, a);
		if ((o === null ? c : o) !== (s === null ? l : s)) return !0;
		if (o === s && c !== l) {
			let e = t.firstChild;
			e ?? T(48);
			let i = Dl().createElement(l);
			return ha(i, this, 0, a, r, n), t.replaceChild(i, e), !1;
		}
		let u = t;
		s !== null && o !== null && (u = t.firstChild, u ?? T(49)), ma(r, u, this);
		let d = n.theme.text;
		d !== void 0 && i !== a && pa(0, i, a, u, d);
		let f = e.__style, p = this.__style;
		return f !== p && (la(t.style, p, f), Jc(t, "style")), !1;
	}
	exportDOM(e) {
		let { element: t } = super.exportDOM(e);
		return U(t) || T(132), t.style.whiteSpace = "pre-wrap", this.hasFormat("lowercase") ? t.style.textTransform = "lowercase" : this.hasFormat("uppercase") ? t.style.textTransform = "uppercase" : this.hasFormat("capitalize") && (t.style.textTransform = "capitalize"), this.hasFormat("bold") && (t = ga(t, "b")), this.hasFormat("italic") && (t = ga(t, "i")), this.hasFormat("strikethrough") && (t = ga(t, "s")), this.hasFormat("underline") && (t = ga(t, "u")), { element: t };
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
		let t = xc(this.getFormat(), e, null);
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
		Ro();
		let n = e, r = t, i = F(), a = this.getTextContent(), o = this.__key;
		if (typeof a == "string") {
			let e = a.length;
			n === void 0 && (n = e), r === void 0 && (r = e);
		} else n = 0, r = 0;
		if (!P(i)) return co(o, n, o, r, "text", "text");
		{
			let e = Ec();
			e !== i.anchor.key && e !== i.focus.key || Tc(o), i.setTextNodeRange(this, n, this, r);
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
		Ro();
		let t = this.getLatest(), n = t.getTextContent();
		if (n === "") return [];
		let r = t.__key, i = Ec(), a = n.length;
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
			i === r && Tc(a), y.push(n);
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
				t !== null && wc(t), n !== null && wc(n);
			})(this);
			let e = u.getWritable(), t = this.getIndexWithinParent();
			h ? (e.splice(t, 0, y), this.remove()) : e.splice(t, 1, y), P(v) && ho(v, u, t, c - 1);
		}
		return y;
	}
	mergeWithSibling(e) {
		let t = e === this.getPreviousSibling();
		t || e === this.getNextSibling() || T(50);
		let n = this.__key, r = e.__key, i = this.__text, a = i.length;
		Ec() === r && Tc(n);
		let o = F();
		if (P(o)) {
			let i = o.anchor, s = o.focus;
			i !== null && i.key === r && I(i, t, n, e, a), s !== null && s.key === r && I(s, t, n, e, a);
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
	if (!U(e)) return !1;
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
	}(t) !== null) return { node: xo(n) };
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
		if (n = e, U(n)) {
			let e = n.style.display;
			if (e === "" && !Bl(n) || e !== "" && !e.startsWith("inline")) return null;
		}
		let r = n;
		for (; (r = t ? n.firstChild : n.lastChild) !== null;) n = r;
		if (vc(n)) return n;
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
	return hl(new va(e));
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
		let t = super.createDOM(e), n = Yc(e.theme, "tab");
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
	return hl(new Aa());
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
		return this.key === e.key ? this.offset < e.offset : Td(Ls(Os(this, "next")), Ls(Os(e, "next"))) < 0;
	}
	getNode() {
		let e = V(this.key);
		return e === null && T(20), e;
	}
	set(e, t, n, r) {
		let i = this._selection, a = this.key;
		r && this.key === e && this.offset === t && this.type === n || (this.key = e, this.offset = t, this.type = n, Lo() || (Ec() === a && Tc(e), i !== null && (i.setCachedNodes(null), P(i) && (i._cachedIsBackward = null), i.dirty = !0)));
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
	} else if (!z(t)) {
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
	if (z(t)) {
		let n = t.getLastDescendant();
		z(n) || N(n) ? Fa(e, n) : Fa(e, t);
	} else Fa(e, t);
}
function La(e, t, n, r) {
	let i = e.getNode(), a = i.getChildAtIndex(e.offset), o = Da();
	if (o.setFormat(n), o.setStyle(r), Ys(a)) a.splice(0, 0, [o]);
	else if (a !== null) {
		let e = pl(i) ? Js().append(o) : o;
		a.insertBefore(e);
	} else if (pl(i)) {
		let e = i.getLastChild();
		z(e) && !e.isInline() && e.isEmpty() ? e.append(o) : i.append(Js().append(o));
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
		let t = this.getNodes().filter((e) => Fu(e) === null), n = t.length;
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
			let t = V(e);
			t !== null && n.push(t);
		}
		return Lo() || (this._cachedNodes = n), n;
	}
	getTextContent() {
		let e = this.getNodes(), t = "";
		for (let n = 0; n < e.length; n++) t += e[n].getTextContent();
		return t;
	}
	deleteNodes() {
		let e = this.getNodes().filter((e) => Fu(e) === null);
		if ((F() || po()) === this && e[0]) {
			let t = fd(e[0], "next");
			As(Cd(t, t));
		}
		for (let t of e) t.remove();
		Ba();
	}
};
function Ba() {
	let e = Nc();
	if (e.getChildrenSize() === 0 && zu(F()) === null) {
		let t = Js();
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
			for (let n of e) if (cd(n)) {
				let { origin: e } = n;
				t.length === 0 ? i.add(e) : (a.add(e), t.push(e));
			} else {
				let { origin: e } = n;
				z(e) && a.has(e) || t.push(e);
			}
			if (r && t.push(r.caret.origin), sd(e.focus) && z(e.focus.origin) && e.focus.getNodeAtCaret() === null) for (let n = gd(e.focus.origin, "previous"); cd(n) && i.has(n.origin) && !n.origin.isEmpty() && n.origin.is(t[t.length - 1]); n = vd(n)) i.delete(n.origin), t.pop();
			for (; t.length > 1;) {
				let e = t[t.length - 1];
				if (!z(e) || a.has(e) || e.isEmpty() || i.has(e)) break;
				t.pop();
			}
			if (t.length === 0 && e.isCollapsed()) {
				let n = Ls(e.anchor), r = Ls(e.anchor.getFlipped()), i = (e) => od(e) ? e.origin : e.getNodeAtCaret(), a = i(n) || i(r) || (e.anchor.getNodeAtCaret() ? n.origin : r.origin);
				t.push(a);
			}
			return t;
		}(zs(Ms(this), "next"));
		return Lo() || (this._cachedNodes = t), t;
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
			if (z(d) && !d.isInline()) {
				l || (c += "\n");
				let e = "";
				for (let t of Vu(d)) {
					let n = Hu(d, t);
					n !== null && (e += n.getTextContent());
				}
				e === "" ? l = !d.isEmpty() : (c += e, l = !1);
			} else if (l = !1, N(d)) {
				let e = d.getTextContent();
				d === t ? d === n ? r.type === "element" && i.type === "element" && i.offset !== r.offset || (e = o < s ? e.slice(o, s) : e.slice(s, o)) : e = a ? e.slice(o) : e.slice(s) : d === n && (e = a ? e.slice(0, s) : e.slice(0, o)), c += e;
			} else !B(d) && !ws(d) || d === n && this.isCollapsed() || (c += d.getTextContent());
		}
		return c;
	}
	applyDOMRange(e) {
		let t = R(), n = t.getEditorState()._selection, r = oo(e.startContainer, e.startOffset, e.endContainer, e.endOffset, t, n);
		if (r === null) return;
		let [i, a, o] = r;
		this.anchor.set(i.key, i.offset, i.type, !0), this.focus.set(a.key, a.offset, a.type, !0), o && (this.dirty = !0), rn(this);
	}
	clone() {
		let t = this.anchor, n = this.focus;
		return new e(Pa(t.key, t.offset, t.type), Pa(n.key, n.offset, n.type), this.format, this.style);
	}
	toggleFormat(e) {
		this.format = xc(this.format, e, null), this.dirty = !0;
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
		this.insertNodes(xo(e));
	}
	insertText(e) {
		let t = this.format, n = this.style;
		if (!this.isCollapsed()) {
			let r = (this.focus.isBefore(this.anchor) ? this.focus : this.anchor).getNode();
			if (N(r) && (t = r.getFormat(), n = r.getStyle()), this.removeText(), this.format = t, this.style = n, e === "") return;
			if (Ec() === null) return this.anchor.type === "element" && La(this.anchor, this.focus, t, n), void Ra(this, e, t, n);
		}
		this.anchor.type === "element" && La(this.anchor, this.focus, t, n);
		let r = this.anchor.getNode();
		N(r) || T(398);
		let i = this.anchor.offset, a = r.getParentOrThrow(), o = r.getTextContentSize();
		if (_c(r) || i === 0 && (!r.canInsertTextBefore() || !a.canInsertTextBefore() && !r.__prev) || i === o && (!r.canInsertTextAfter() || !a.canInsertTextAfter() && !r.__next)) {
			if (r.isSegmented() && i !== 0 && i !== o) {
				if (Ec() !== null) r.setMode("normal").setFormat(t).setStyle(n);
				else {
					let e = Da(r.getTextContent());
					e.setFormat(t), e.setStyle(n);
					let a = F() === this;
					r.replace(e), this.setTextNodeRange(e, i, e, i), a && F() !== this && Fc(this);
				}
				e !== "" && this.insertText(e);
				return;
			}
			if (e === "") return;
			if (i === 0) {
				let i = r.getPreviousSibling();
				if (N(i) && i.canInsertTextAfter() && !_c(i)) i.select();
				else {
					let e = Da();
					e.setFormat(t), e.setStyle(n), a.canInsertTextBefore() ? r.insertBefore(e) : a.insertBefore(e), e.select();
				}
				this.insertText(e);
				return;
			}
			if (i === o) {
				let i = r.getNextSibling();
				if (N(i) && i.canInsertTextBefore() && !_c(i)) i.select(0, 0);
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
		js(this, Is(Ms(this))), this.isCollapsed() && function(e, t) {
			let n = e.anchor;
			if (n.key === t) return;
			let r = n.getNode(), i = 0, a = "";
			N(r) ? (i = r.getFormat(), a = r.getStyle()) : z(r) && (i = r.getTextFormat(), a = r.getTextStyle()), e.format === i && e.style === a || (e.format = i, e.style = a, e.dirty = !0);
		}(this, t), e && F() !== this && Fc(this);
	}
	formatText(e, t = null) {
		Wa(this, e, t);
	}
	insertNodes(e) {
		if (e.length === 0) return;
		this.isCollapsed() || this.removeText();
		let t = this.anchor.getNode();
		if (this.anchor.type === "element" && z(t) && t.isShadowRoot() && Fu(t) !== null) {
			let n = t.getFirstChild() ?? t.append(Js()).getFirstChild();
			if (n !== null && !z(n)) {
				let e = Js();
				n.insertBefore(e), n = e;
			}
			if (n !== null) {
				n.selectStart();
				let t = F();
				return P(t) || T(369), t.insertNodes(e);
			}
		}
		if (this.anchor.type === "element" && pl(t)) {
			let n = Eo(e), r = n.getLastDescendant();
			t.splice(this.anchor.offset, 0, n.getChildren()), r !== null && r.selectEnd();
			return;
		}
		let n = this.isBackward() ? this.focus : this.anchor, r = n.getNode(), i = ku(r, K), a = e[e.length - 1];
		if (z(i) && "__language" in i) {
			if ("__language" in e[0]) this.insertText(e[0].getTextContent());
			else {
				let [, t] = Co(this);
				i.splice(t, 0, e), a.selectEnd();
			}
			return;
		}
		if (!e.some((e) => (z(e) || B(e)) && !e.isInline())) {
			z(i) || T(211, r.constructor.name, r.getType());
			let [t, n] = Co(this, !0);
			(z(t) ? t : i).splice(n, 0, e), a.selectEnd();
			return;
		}
		if (z(i) && Fu(i) !== null) {
			let [, t] = Co(this), n = So(e);
			i.splice(t, 0, n);
			let r = n[n.length - 1];
			r === void 0 ? i.select(t, t) : r.selectEnd();
			return;
		}
		if (i === null) {
			let t = Eo(e), n = t.getLastDescendant(), r = Os(this.anchor, "next");
			for (let e of t.getChildren()) r = Ws(e, r);
			n !== null && n.selectEnd();
			return;
		}
		if (z(i) && !i.isParentRequired() && !pl(i.getParentOrThrow())) {
			let [, t] = Co(this), n = So(e);
			i.splice(t, 0, n);
			let r = n[n.length - 1];
			r === void 0 ? i.select(t, t) : r.selectEnd();
			return;
		}
		let o = Eo(e), s = o.getLastDescendant(), c = o.getChildren(), l = function(e) {
			let t = function(e) {
				let t = e.getNode();
				if (e.offset > 0) return e.type === "element" && z(t) ? t.getChildAtIndex(e.offset - 1) : null;
				for (let e = t; e !== null && !K(e) && !pl(e); e = e.getParent()) {
					let t = e.getPreviousSibling();
					if (t !== null) return t;
				}
				return null;
			}(e);
			return ws(t) && ws(t.getPreviousSibling());
		}(n), u = z(i) && i.isEmpty() ? null : this.insertParagraph();
		u && !i.isAttached() && (r = this.anchor.getNode(), i = ku(r, K));
		let d = c[c.length - 1], f = c[0];
		var p = f;
		l || !z(p) || !K(p) || p.isEmpty() || !z(i) || i.isEmpty() && !i.canMergeWhenEmpty() || (z(i) || T(211, r.constructor.name, r.getType()), i.append(...f.getChildren()), f = c[1]), f && (i === null && T(212, r.constructor.name, r.getType()), function(e, t) {
			let n = t.getParentOrThrow().getLastChild(), r = t, i = [t];
			for (; r !== n;) r.getNextSibling() || T(140), r = r.getNextSibling(), i.push(r);
			let a = e;
			for (let e of i) a = a.insertAfter(e);
		}(i, f));
		let m = ku(s, K), h = s.selectEnd();
		u && (z(m) && (u.canMergeWhenEmpty() || K(d)) ? (m.append(...u.getChildren()), u.remove()) : u.isEmpty() && u.remove()), z(i) && i.isEmpty() && i.remove();
		let g = z(i) ? i.getLastChild() : null;
		ws(g) && m !== i && g.remove();
		let _ = Ls(Os(h.anchor, "next"));
		ks(h.anchor, _), ks(h.focus, _);
	}
	insertParagraph() {
		this.isCollapsed() || this.removeText();
		let e = this.anchor.getNode();
		if (this.anchor.type === "element" && pl(e)) {
			let t = Js();
			return e.splice(this.anchor.offset, 0, [t]), t.select(), t;
		}
		let [, t] = Co(this), n = ku(this.anchor.getNode(), K);
		if (n !== null && Fu(n) !== null) return null;
		z(n) || T(213);
		let r = n.getChildAtIndex(t), i = r ? [r, ...r.getNextSiblings()] : [], a = n.insertNewAfter(this, !1);
		return a ? (a.append(...i), a.selectStart(), a) : null;
	}
	insertLineBreak(e) {
		let t = Cs();
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
		if (Do(this, e, t, n)) return;
		let r = e === "move", i = R(), a = bl(ll(i));
		if (!a) return;
		let o = i._blockCursorElement, s = i._rootElement, c = this.focus.getNode();
		s === null || o === null || !z(c) || c.isInline() || c.canBeEmpty() || yl(o, i, s);
		let l = el(i, this.focus.key), u = l;
		if (this.focus.type === "text" && (u = N(c) ? Ul(c, l, i) : null), this.dirty) {
			let e = el(i, this.anchor.key), t = e;
			if (this.anchor.type === "text") {
				let n = this.anchor.getNode();
				t = N(n) ? Ul(n, e, i) : null;
			}
			t && u && L(a, t, this.anchor.offset, u, this.focus.offset);
		}
		if (n === "character" && N(c) && c.isUnmergeable() && (t ? this.focus.offset === 0 : this.focus.offset === c.getTextContentSize())) {
			let e = fd(c, t ? "previous" : "next").getNodeAtCaret();
			if (N(e)) {
				if (!r) {
					let n = e.getTextContentSize();
					t ? this.focus.set(e.__key, n - 1, "text") : this.focus.set(e.__key, 1, "text"), this.dirty = !0;
					return;
				}
				{
					let n = i.getElementByKey(e.getKey()), r = n ? Ul(e, n, i) : null;
					if (r) {
						let e = t ? r.length : 0;
						L(a, r, e, r, e);
					}
				}
			}
		}
		if (Ya(a, e, t ? "backward" : "forward", n, s), a.rangeCount > 0) {
			let e = Ol(a, i._rootElement), n = e || a.getRangeAt(0), o = this.anchor.getNode(), s = ms(o) ? o : dl(o);
			this.applyDOMRange(n), this.dirty = !0, r || (Xa(this, t, s), (e ? a.direction !== "backward" : a.anchorNode === n.startContainer && a.anchorOffset === n.startOffset) || Ja(this));
		}
		n === "lineboundary" && Do(this, e, t, n, "decorators");
	}
	forwardDeletion(e, t, n) {
		if (!n && (e.type === "element" && z(t) && e.offset === t.getChildrenSize() || e.type === "text" && e.offset === t.getTextContentSize())) {
			let e = t.getParent(), n = t.getNextSibling() || (e === null ? null : e.getNextSibling());
			if (z(n) && n.isShadowRoot()) return !0;
		}
		return !1;
	}
	deleteCharacter(e) {
		let t = this.isCollapsed();
		if (this.isCollapsed()) {
			let t = this.anchor, n = t.getNode();
			if (this.forwardDeletion(t, n, e)) {
				let e = z(n) ? n.getNextSibling() : null;
				if (!(z(n) && n.isEmpty() && z(e) && e.isShadowRoot())) return;
			}
			let r = Os(t, e ? "previous" : "next"), i = X(r);
			if (i.getTextSlices().every((e) => e === null || e.distance === 0)) {
				if (t.type === "element") {
					let e = r.getNodeAtCaret();
					if (z(e) && vl(e)) {
						let t = e.getParent();
						e.remove();
						let n = Pc(t, e);
						n !== null && n.selectStart();
						return;
					}
				}
				let e = { type: "initial" };
				for (let t of i.iterNodeCarets("shadowRoot")) if (cd(t)) {
					if (!t.origin.isInline()) {
						if (t.origin.isShadowRoot()) {
							if (e.type === "merge-block") break;
							if (z(i.anchor.origin) && i.anchor.origin.isEmpty()) {
								let e = Ls(t);
								js(this, Cd(e, e)), i.anchor.origin.remove();
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
					if (sd(t)) {
						if (z(t.origin)) {
							if (t.origin.isInline()) {
								if (!t.origin.isParentOf(i.anchor.origin)) break;
							} else e = {
								block: t.origin,
								type: "merge-next-block"
							};
							continue;
						}
						if (B(t.origin)) {
							if (!t.origin.isIsolated()) {
								if (e.type === "merge-next-block" && (t.origin.isKeyboardSelectable() || !t.origin.isInline()) && z(i.anchor.origin) && i.anchor.origin.isEmpty()) {
									i.anchor.origin.remove();
									let e = uo();
									e.add(t.origin.getKey()), Fc(e);
								} else {
									let e = t.origin, n = e.getParent();
									e.remove();
									let r = Pc(n, e);
									r !== null && r.selectStart();
								}
							}
							return;
						}
						if (ws(t.origin)) return void t.origin.remove();
						break;
					}
				}
				if (e.type === "merge-block") {
					let { caret: t, block: n } = e;
					return Vu(n).length > 0 ? void 0 : t.origin.isEmpty() && !n.isEmpty() && t.origin.getParent() === n.getParent() ? void t.origin.remove(!0) : (js(this, Cd(!t.origin.isEmpty() && n.isEmpty() ? Ns(fd(n, t.direction)) : i.anchor, t)), this.removeText());
				}
				for (let e = t.getNode(); e !== null;) {
					if (Fu(e) !== null) return;
					if (z(e) && e.isShadowRoot()) break;
					e = e.getParent();
				}
			}
			let a = this.focus;
			if (Za(this, e, "character"), this.isCollapsed()) {
				if (e && t.offset === 0 && function(e, t) {
					for (let n = t; n; n = n.getParent()) {
						if (z(n)) {
							if (n.collapseAtStart(e)) return !0;
							if (pl(n)) break;
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
						c !== u && !Rc(a = i.getTextContent().slice(c, l)) && !$a(a) && (t ? r.set(r.key, u, r.type) : n.set(n.key, u, n.type));
					}
					var a;
				})(this, e);
			}
		}
		t || qa(this), this.removeText(), e && !t && this.isCollapsed() && this.anchor.type === "element" && this.anchor.offset === 0 && Ba();
	}
	deleteLine(e) {
		let t = this.isCollapsed(), n = ro(this.anchor);
		if (n !== null && B(Iu(n))) return this.isCollapsed() || this.focus.set(this.anchor.key, this.anchor.offset, this.anchor.type), void this.deleteCharacter(e);
		this.isCollapsed() && Za(this, e, "lineboundary"), this.isCollapsed() ? this.deleteCharacter(e) : ku(this.anchor.getNode(), K) === ku(this.focus.getNode(), K) ? (t || qa(this), this.removeText()) : (this.focus.set(this.anchor.key, this.anchor.offset, this.anchor.type), this.deleteCharacter(e));
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
		return Lo() || (this._cachedIsBackward = t), t;
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
	if (e.isCollapsed()) return e.setFormat(t(e.format)), void Tc(null);
	let n = [];
	for (let r of e.getNodes()) N(r) ? n.push(r) : z(r) ? r.setTextFormat(t(r.getTextFormat())) : _a(r) && r.setFormat(t(r.getFormat()));
	let r = n.length;
	if (r === 0) return e.setFormat(t(e.format)), void Tc(null);
	let i = e.anchor, a = e.focus, o = e.isBackward(), s = o ? a : i, c = o ? i : a, l = 0, u = n[0], d = s.type === "element" ? 0 : s.offset;
	if (s.type === "text" && d === u.getTextContentSize() && (l = 1, u = n[1], d = 0), u == null) return;
	let f = r - 1, p = n[f], m = c.type === "text" ? c.offset : p.getTextContentSize();
	if (u.is(p)) {
		if (d === m) return;
		let n = t(u.getFormat());
		if (_c(u) || d === 0 && m === u.getTextContentSize()) u.setFormat(n);
		else {
			let e = u.splitText(d, m), t = d === 0 ? e[0] : e[1];
			t.setFormat(n), s.type === "text" && s.set(t.__key, 0, "text"), c.type === "text" && c.set(t.__key, m - d, "text");
		}
		e.format = n;
		return;
	}
	d === 0 || _c(u) || ([, u] = u.splitText(d), d = 0);
	let h = t(u.getFormat());
	u.setFormat(h);
	let g = t(p.getFormat());
	m > 0 && (m === p.getTextContentSize() || _c(p) || ([p] = p.splitText(m)), p.setFormat(g));
	for (let e = l + 1; e < f; e++) {
		let r = n[e];
		r.setFormat(t(r.getFormat()));
	}
	s.type === "text" && s.set(u.__key, d, "text"), c.type === "text" && c.set(p.__key, m, "text"), e.format = h | g;
}
function Wa(e, t, n = null) {
	let r = n === null && P(e) ? xc(e.format, t, null) : n;
	Ua(e, (e) => xc(e, t, r));
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
	let t = Nc();
	!t.isEmpty() && Gs(t, e) && (e.anchor.set(t.getKey(), 0, "element"), e.focus.set(t.getKey(), t.getChildrenSize(), "element"));
}
function Ja(e) {
	let t = e.focus, n = e.anchor, r = n.key, i = n.offset, a = n.type;
	n.set(t.key, t.offset, t.type, !0), t.set(r, i, a, !0);
}
function Ya(e, t, n, r, i) {
	let a = r === "character" ? Al(e, i) : null, o = a && a.focusNode, s = a ? a.focusOffset : 0;
	if (e.modify(t, n, r), a === null || !function(e, t, n) {
		return e !== null && e.nodeType === 3 && (n === "backward" ? t > 0 : n === "forward" && t < e.length);
	}(o, s, n)) return;
	let c = Al(e, i);
	c.focusNode === o && c.focusOffset === s && e.modify(t, n, r);
}
function Xa(e, t, n) {
	let r = e.getNodes(), i = r.filter((e) => sl(e, n));
	if (i.length === 0 || i.length === r.length) return !1;
	let a = t ? i[0] : i[i.length - 1], o = z(a) ? a : a.getParentOrThrow();
	return t ? o.selectStart() : o.selectEnd(), !0;
}
function Za(e, t, n) {
	if (Do(e, "extend", t, n)) return;
	let r = R(), i = bl(ll(r));
	if (!i || typeof i.modify != "function") return;
	let a = r._blockCursorElement, o = r._rootElement, s = e.anchor, c = e.focus.getNode();
	o === null || a === null || !z(c) || c.isInline() || c.canBeEmpty() || yl(a, r, o);
	let l = (e) => {
		let t = e.getNode(), n = r.getElementByKey(e.key);
		return n !== null && e.type === "text" && N(t) ? Ul(t, n, r) : n;
	}, u = s.getNode(), d = l(s);
	if (d === null) return;
	let f = s.offset, p = e.isCollapsed(), m = e.focus, h = p ? d : l(m);
	if (h === null) return;
	let g = m.offset;
	if (L(i, h, g, h, g), Ya(i, "move", t ? "backward" : "forward", n, o), i.rangeCount === 0) return;
	let _ = Ol(i, o) || i.getRangeAt(0), v = _.startContainer, y = _.startOffset;
	if (n === "lineboundary" && vc(v) && mc(v) === r) {
		let e = Lc(v);
		if (B(e) && e.isInline() && !e.isIsolated()) {
			let n = r.getElementByKey(e.getKey());
			n !== null && n.contains(v) && (v = n, y = t ? 0 : n.childNodes.length);
		}
	}
	if (p && n === "character" && s.type === "text" && N(u) && u.isUnmergeable() && f === (t ? 0 : u.getTextContentSize())) {
		let n = fd(u, t ? "previous" : "next").getNodeAtCaret();
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
	], w = ms(u) ? u : dl(u);
	e.applyDOMRange({
		collapsed: !1,
		endContainer: S,
		endOffset: C,
		startContainer: b,
		startOffset: x
	}), e.dirty = !0, !Xa(e, t, w) && t && Ja(e), n === "lineboundary" && Do(e, "extend", t, n, "decorators");
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
	if (U(e)) {
		let s = !1, c = e.childNodes, l = c.length, u = r._blockCursorElement;
		a === l && l > 0 && (s = !0, a = l - 1), kc(e, r) !== void 0 || tu(e, r) || (o = !0);
		let d = c[a], f = !1;
		if (d === u) d = c[a + 1], f = !0;
		else if (u !== null) {
			let n = u.parentNode;
			e === n && t > Array.prototype.indexOf.call(n.children, u) && a--;
		}
		if (i = Lc(d), N(i)) a = md(i, s ? "next" : "previous");
		else {
			let c = Lc(e);
			if (c === null) return null;
			if (z(c)) {
				let o = r.getElementByKey(c.getKey());
				o === null && T(214);
				let l = Vl(c, o, r);
				[c, a] = l.resolveChildIndex(c, o, e, t), z(c) || T(215), s && a >= c.getChildrenSize() && (a = Math.max(0, c.getChildrenSize() - 1));
				let u = c.getChildAtIndex(a);
				if (z(u) && function(e, t, n) {
					let r = e.getParent();
					return n === null || r === null || !r.canBeEmpty() || r !== n.getNode();
				}(u, 0, n)) {
					let e = s ? u.getLastDescendant() : u.getFirstDescendant();
					e === null ? c = u : (u = e, c = z(u) ? u : u.getParentOrThrow()), a = 0;
				}
				N(u) ? (i = u, c = null, a = md(u, s ? "next" : "previous")) : u !== c && s && !f && (z(c) || T(216), a = Math.min(c.getChildrenSize(), a + 1));
			} else {
				let n = Iu(c), i = n === null ? c : n, o = i.getIndexWithinParent(), s = r.getElementByKey(c.getKey()), l = "after";
				if (s !== null && Lc(e) === c) {
					let n = Vl(c, s, r);
					n.element === s ? t === 0 && B(c) && (l = "before") : l = n.resolveLeafPosition(s, e, t);
				}
				a = l === "before" ? o : o + 1, c = i.getParentOrThrow();
			}
			if (z(c)) return [Pa(c.__key, a, "element"), o];
		}
	} else i = Lc(e);
	return N(i) ? [Pa(i.__key, md(i, a, "clamp"), "text"), o] : null;
}
function no(e, t, n) {
	let r = e.offset, i = e.getNode();
	if (r === 0) {
		let r = i.getPreviousSibling(), a = i.getParent();
		if (t) {
			if ((n || !t) && r === null && z(a) && a.isInline()) {
				let t = a.getPreviousSibling();
				N(t) && e.set(t.__key, t.getTextContent().length, "text");
			}
		} else z(r) && !n && r.isInline() ? e.set(r.__key, r.getChildrenSize(), "element") : N(r) && !i.isUnmergeable() && e.set(r.__key, r.getTextContent().length, "text");
	} else if (r === i.getTextContent().length) {
		let r = i.getNextSibling(), a = i.getParent();
		if (t && z(r) && r.isInline()) e.set(r.__key, 0, "element");
		else if ((n || t) && r === null && z(a) && a.isInline() && !a.canInsertTextAfter() && a.getTextContentSize() > 1) {
			let t = a.getNextSibling();
			N(t) && e.set(t.__key, 0, "text");
		}
	}
}
function ro(e) {
	let t = V(e.key);
	return t === null ? null : Ru(t);
}
function io(e, t, n) {
	let r = ro(e), i = ro(t);
	if (r === i || r !== null && i !== null && r.is(i)) return !1;
	let a = n(r, i);
	if (r !== null) return z(r) ? t.set(r.getKey(), a ? r.getChildrenSize() : 0, "element") : t.set(r.getKey(), a ? r.getTextContentSize() : 0, "text"), !0;
	let o = Iu(i);
	if (o === null) return !1;
	let s = o.getParent();
	if (s === null) return !1;
	let c = o.getIndexWithinParent();
	return t.set(s.getKey(), a ? c + 1 : c, "element"), !0;
}
function ao(e) {
	let t = io(e.anchor, e.focus, (t, n) => function(e, t, n, r) {
		if (n !== null && r !== null) {
			let e = Iu(n), t = Iu(r);
			if (e !== null && e.is(t)) {
				for (let t of Bu(e).values()) {
					if (t === n.getKey()) return !0;
					if (t === r.getKey()) return !1;
				}
				return !0;
			}
			return e === null || t === null || e.isBefore(t);
		}
		if (n !== null) {
			let e = Iu(n), r = V(t.key);
			return e === null || r === null || !(!e.is(r) && !e.isParentOf(r)) || e.isBefore(r);
		}
		let i = Iu(r), a = V(e.key);
		return i !== null && a !== null && !i.is(a) && !i.isParentOf(a) && a.isBefore(i);
	}(e.anchor, e.focus, t, n));
	return t && (e.dirty = !0), t;
}
function oo(e, t, n, r, i, a) {
	if (e === null || n === null || !fc(i, e, n)) return null;
	let o = to(e, t, P(a) ? a.anchor : null, i);
	if (o === null) return null;
	let s = to(n, r, P(a) ? a.focus : null, i);
	if (s === null) return null;
	let [c, l] = o, [u, d] = s;
	if (c.type === "element" && u.type === "element") {
		let t = Lc(e), r = Lc(n);
		if (B(t) && B(r)) return null;
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
	return z(e) && !e.isInline();
}
function co(e, t, n, r, i, a) {
	let o = Bo(), s = new Va(Pa(e, t, i), Pa(n, r, a), 0, "");
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
		let r = Al(t, n._rootElement);
		if (l = r.anchorNode, u = r.focusNode, d = r.anchorOffset, f = r.focusOffset, (s || o === void 0) && P(e) && !fc(n, l, u)) return e.clone();
	}
	let p = oo(l, d, u, f, n, e);
	if (p === null) return null;
	let [m, h, g] = p, _ = 0, v = "";
	if (P(e)) {
		let t = e.anchor;
		if (m.key === t.key) _ = e.format, v = e.style;
		else {
			let e = m.getNode();
			N(e) ? (_ = e.getFormat(), v = e.getStyle()) : z(e) && (_ = e.getTextFormat(), v = e.getTextStyle());
		}
	}
	let y = new Va(m, h, _, v);
	return g && (y.dirty = !0), y;
}
function F() {
	return Bo()._selection;
}
function po() {
	return R()._editorState._selection;
}
function mo(e, t) {
	let n = t.__key;
	return e.anchor.key === n || e.focus.key === n;
}
function ho(e, t, n, r = 1) {
	if (!mo(e, t)) return;
	let i = e.anchor, a = e.focus, o = t.__key;
	if (e.isCollapsed()) {
		let t = i.offset;
		if (n <= t && r > 0 || n < t && r < 0) {
			let n = Math.max(0, t + r);
			i.set(o, n, "element"), a.set(o, n, "element"), go(e);
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
	go(e);
}
function go(e) {
	let t = e.anchor, n = t.offset, r = e.focus, i = r.offset, a = t.getNode(), o = r.getNode();
	if (e.isCollapsed()) {
		if (!z(a)) return;
		let e = a.getChildrenSize(), i = n >= e, o = i ? a.getChildAtIndex(e - 1) : a.getChildAtIndex(n);
		if (N(o)) {
			let e = 0;
			i && (e = o.getTextContentSize()), t.set(o.__key, e, "text"), r.set(o.__key, e, "text");
		}
		return;
	}
	if (z(a)) {
		let e = a.getChildrenSize(), r = n >= e, i = r ? a.getChildAtIndex(e - 1) : a.getChildAtIndex(n);
		if (N(i)) {
			let e = 0;
			r && (e = i.getTextContentSize()), t.set(i.__key, e, "text");
		}
	}
	if (z(o)) {
		let e = o.getChildrenSize(), t = i >= e, n = t ? o.getChildAtIndex(e - 1) : o.getChildAtIndex(i);
		if (N(n)) {
			let e = 0;
			t && (e = n.getTextContentSize()), r.set(n.__key, e, "text");
		}
	}
}
function _o(e, t, n, r, i) {
	let a = null, o = 0, s = null;
	r === null ? i !== null && (a = i.__key, N(i) ? s = "text" : z(i) && (s = "element")) : (a = r.__key, N(r) ? (o = r.getTextContentSize(), s = "text") : z(r) && (o = r.getChildrenSize(), s = "element")), a !== null && s !== null ? e.set(a, o, s) : (o = t.getIndexWithinParent(), o === -1 && (o = n.getChildrenSize()), e.set(n.__key, o, "element"));
}
function I(e, t, n, r, i) {
	e.type === "text" ? e.set(n, e.offset + (t ? 0 : i), "text") : e.offset > r.getIndexWithinParent() && e.set(e.key, e.offset - 1, "element");
}
function L(e, t, n, r, i) {
	try {
		e.setBaseAndExtent(t, n, r, i);
	} catch {}
}
function vo(e, t, n) {
	let r = el(e, t.getKey());
	if (z(t)) {
		let i = Vl(t, r, e);
		return [i.element, n + i.getFirstChildOffset()];
	}
	return [r, n];
}
function yo(e, t, n, r, i, a) {
	let o = a.getRootNode(), s = yc(o) || Sl(o) ? Fl(o) : null;
	if (i.has("collaboration") && s !== a || s !== null && dc(s, s)) return;
	let c = Al(r, a), l;
	if (!P(t)) return void (e !== null && fc(n, c.anchorNode, c.focusNode) && r.removeAllRanges());
	let u = t.anchor, d = t.focus, f = u.getNode(), p = d.getNode(), [m, h] = vo(n, f, u.offset), [g, _] = vo(n, p, d.offset), v = t.format, y = t.style, b = t.isCollapsed(), x = m, S = g, C = !1;
	if (u.type === "text" ? (x = N(f) ? Ul(f, m, n) : null, C = f.getFormat() !== v || f.getStyle() !== y) : P(e) && e.anchor.type === "text" && (C = !0), d.type === "text" && (S = N(p) ? Ul(p, g, n) : null), x !== null && S !== null) {
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
				let e = s === null ? null : mc(s);
				e !== null && e !== n || i.has("skip-selection-focus") || a.focus({ preventScroll: !0 });
			}
			if (u.type !== "element") return;
		}
		if (L(r, x, h, S, _), O && t.isCollapsed() && a !== null && !i.has("skip-selection-focus")) {
			let e = Pl(a);
			if (e === null || !a.contains(e)) {
				let e = Fl(a.ownerDocument), t = e === null ? null : mc(e);
				t !== null && t !== n || a.focus({ preventScroll: !0 });
			}
		}
		if (!i.has("skip-scroll-into-view") && t.isCollapsed() && a !== null && a === Pl(a)) {
			let e = P(t) && t.anchor.type === "element" ? function(e, t, n) {
				let r = t.childNodes[n];
				if (!U(r)) return r || null;
				let i = kc(r, e), a = i === void 0 ? null : V(i);
				return a === null || z(a) ? r : Vl(a, r, e).element;
			}(n, x, h) : (l === void 0 && (l = kl(r, a)), l);
			if (e !== null) {
				let t;
				if (vc(e)) {
					let n = e.ownerDocument.createRange();
					n.selectNode(e), t = n.getBoundingClientRect();
				} else t = U(e) ? e.getBoundingClientRect() : function(e) {
					let t = e.getBoundingClientRect(), { startContainer: n, startOffset: r } = e;
					if (!e.collapsed || t.width !== 0 || t.height !== 0 || !vc(n) || n.length === 0) return t;
					let i = e.cloneRange();
					return r > 0 ? i.setStart(n, r - 1) : i.setEnd(n, 1), i.getBoundingClientRect();
				}(e);
				(function(e, t, n, r = null) {
					let i = nl(n), a = cl(i);
					if (i === null || a === null) return;
					let o = n.getBoundingClientRect();
					if (t.bottom < o.top) return;
					if (r !== null && t.height > 0) {
						let { left: e, right: i } = t, o = U(r) ? r : tl(r);
						for (; o !== null && n.contains(o);) {
							let t = il(a, o, e, i);
							e -= t, i -= t, o = o === n ? null : tl(o);
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
							} else l = 0, u = ll(e).innerHeight;
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
						d = tl(d);
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
function bo(e, t) {
	for (let n of e.split(/(\r?\n|\t)/)) n === "\n" || n === "\r\n" ? t.linebreak() : n === "	" ? t.tab() : n !== "" && t.text(n);
}
function xo(e) {
	let t = [];
	return bo(e, {
		linebreak: () => t.push(Cs()),
		tab: () => t.push(ja()),
		text: (e) => t.push(Da(e))
	}), t;
}
function So(e) {
	let t = [];
	for (let n of e) ws(n) || (!z(n) && !B(n) || n.isInline() ? t.push(n) : z(n) && t.push(...So(n.getChildren())));
	return t;
}
function Co(e, t = !1) {
	let n = e;
	e.isCollapsed() || n.removeText();
	let r = F();
	P(r) && (n = r), P(n) || T(161);
	let i = n.anchor, a = i.getNode(), o = i.offset;
	for (; !K(a) && Fu(a) === null;) {
		let e = a;
		if ([a, o] = wo(a, o, t), e.is(a)) break;
	}
	return [a, o];
}
function wo(e, t, n = !1) {
	let r = e.getParent();
	if (!r) {
		let e = Js();
		return Nc().append(e), e.select(), [Nc(), 0];
	}
	if (N(e)) {
		let n = e.splitText(t);
		if (n.length === 0) return [r, e.getIndexWithinParent()];
		let i = t === 0 ? 0 : 1;
		return [r, n[0].getIndexWithinParent() + i];
	}
	if (!z(e) || t === 0) return [r, e.getIndexWithinParent()];
	let i = e.getChildAtIndex(t);
	if (i) {
		let r = new Va(Pa(e.__key, t, "element"), Pa(e.__key, t, "element"), 0, ""), a = e.insertNewAfter(r);
		if (a) a.append(i, ...i.getNextSiblings());
		else if (n) return [e, t];
	}
	return [r, e.getIndexWithinParent() + 1];
}
function To(e) {
	return ws(e) || ul(e) || N(e) || e.isParentRequired();
}
function Eo(e) {
	let t = Js(), n = null;
	for (let r = 0; r < e.length; r++) {
		let i = e[r];
		if (To(i)) {
			if (n === null) {
				n = i.createParentElementNode(), t.append(n);
				let a = e[r + 1];
				if (ws(i) && (a === void 0 || !To(a))) continue;
			}
			n.append(i);
		} else t.append(i), n = null;
	}
	return t;
}
function Do(e, t, n, r, i = "decorators-and-blocks") {
	if (t === "move" && r === "character" && !e.isCollapsed()) {
		let [t, r] = n === e.isBackward() ? [e.focus, e.anchor] : [e.anchor, e.focus];
		return r.set(t.key, t.offset, t.type), !0;
	}
	let a = Os(e.focus, n ? "previous" : "next"), o = r === "lineboundary", s = t === "move", c = a, l = i === "decorators-and-blocks", u = !1;
	if (!Rs(c)) {
		for (let e of c) {
			l = !1;
			let { origin: t } = e;
			if (B(t)) {
				if (t.isIsolated()) {
					u = !0;
					break;
				}
				if (c = e, o && t.isInline()) continue;
			}
			break;
		}
		if (u) return !0;
		if (l) for (let e of X(a).iterNodeCarets(t === "extend" ? "shadowRoot" : "root")) {
			if (cd(e)) e.origin.isInline() || (c = e);
			else {
				if (z(e.origin)) continue;
				B(e.origin) && !e.origin.isInline() && (c = e);
			}
			break;
		}
	}
	if (c === a) return !1;
	if (s && !o && B(c.origin) && c.origin.isKeyboardSelectable()) {
		let e = uo();
		return e.add(c.origin.getKey()), Fc(e), !0;
	}
	return c = Ls(c), s && ks(e.anchor, c), ks(e.focus, c), l || !o;
}
var Oo = null, ko = null, Ao = !1, jo = !1, Mo = !1, No = /* @__PURE__ */ new Set(), Po = /* @__PURE__ */ new Set(), Fo = 0, Io = {
	characterData: !0,
	childList: !0,
	subtree: !0
};
function Lo() {
	return Ao || Oo !== null && Oo._readOnly;
}
function Ro() {
	Ao && T(13);
}
function zo() {
	Fo > 99 && T(14);
}
function Bo() {
	return Oo === null && T(195, Uo()), Oo;
}
function Vo(e) {
	Bo() !== null && ko === null && (ko = e), ko !== e && le(378);
}
function R() {
	return ko === null && T(337, Uo()), ko;
}
function Ho() {
	R()._dirtyType = 2;
}
function Uo() {
	let e = 0, t = /* @__PURE__ */ new Set(), n = rc.version;
	if (typeof window < "u") for (let r of Tl(document)) {
		let i = hc(r);
		if (pc(i)) e++;
		else if (i) {
			let e = String(i.constructor.version || "<0.17.1");
			e === n && (e += " (separately built, likely a bundler configuration issue)"), t.add(e);
		}
	}
	let r = ` Detected on the page: ${e} compatible editor(s) with version ${n}`;
	return t.size && (r += ` and incompatible editors with versions ${Array.from(t).join(", ")}`), r;
}
function Wo() {
	return ko;
}
function Go(e, t, n) {
	let r = t.__type, i = cc(e, r), a = n.get(r);
	a === void 0 && (a = Array.from(i.transforms), n.set(r, a));
	let o = a.length;
	for (let e = 0; e < o && (a[e](t), t.isAttached()); e++);
}
function Ko(e, t) {
	return e !== void 0 && e.__key !== t && e.isAttached();
}
function qo(e, t) {
	if (!t) return;
	let n = e._updateTags, r = t;
	Array.isArray(t) || (r = [t]);
	for (let e of r) n.add(e);
}
function Jo(e, t) {
	let n = e.type, r = t.get(n);
	r === void 0 && T(17, n);
	let i = r.klass;
	e.type !== i.getType() && T(18, i.name);
	let a = i.importJSON(e), o = e.children;
	if (z(a) && Array.isArray(o)) for (let e = 0; e < o.length; e++) {
		let n = Jo(o[e], t);
		a.append(n);
	}
	let s = e.$slots;
	if (s) {
		Nu(a) || T(379, i.name);
		for (let e in s) Xu(a, e, Jo(s[e], t));
	}
	return a;
}
function Yo(e, t, n) {
	let r = Oo, i = Ao, a = ko;
	Oo = t, Ao = !0, ko = e;
	try {
		return n();
	} finally {
		Oo = r, Ao = i, ko = a;
	}
}
function Xo(e, t) {
	let n = Mo;
	Mo = !0;
	try {
		let n = function(e) {
			if (Po.has(e)) return !1;
			Po.add(e);
			try {
				for (let t = 0; e._pendingEditorState !== null; t++) {
					let n = e._pendingEditorState._selection, r = e._rootElement;
					if (!Qo(e, n)) return !1;
					let i = (n === null || P(n)) && (e._headless || r === null || !r.isConnected);
					if (i || t === 100) return e._lastNotifiedSelection = n === null ? null : n.clone(), !i;
					ns(e, () => e.dispatchCommand(rr), void 0, !0);
				}
				return !1;
			} finally {
				Po.delete(e);
			}
		}(e);
		(function(e, t) {
			let n = e._pendingEditorState, r = e._rootElement, i = e._headless || r === null;
			if (n === null) return void (!e._updating && e._deferred.length > 0 && es(e, e._deferred));
			let a = e._editorState, o = a._selection, s = n._selection, c = e._dirtyType !== 0, l = Oo, u = Ao, d = ko, f = e._updating, p = e._observer, m = null;
			if (e._pendingEditorState = null, e._editorState = n, !i && c && p !== null) {
				ko = e, Oo = n, Ao = !1, e._updating = !0;
				try {
					let t = e._dirtyType, r = e._dirtyElements, i = e._dirtyLeaves;
					p.disconnect(), m = er(a, n, e, t, r, i);
				} catch (t) {
					if (t instanceof Error && e._onError(t), jo) throw t;
					Zs(e, null, r, n), pt(e), e._dirtyType = 2, jo = !0, Xo(e, a), jo = !1;
					return;
				} finally {
					p.observe(r, Io), e._updating = f, Oo = l, Ao = u, ko = d;
				}
			}
			n._readOnly ||= !0;
			let h = e._dirtyLeaves, g = e._dirtyElements, _ = e._normalizedNodes, v = e._updateTags;
			c && (e._dirtyType = 0, e._cloneNotNeeded.clear(), e._dirtyLeaves = /* @__PURE__ */ new Set(), e._dirtyElements = /* @__PURE__ */ new Map(), e._normalizedNodes = /* @__PURE__ */ new Set()), e._updateTags = /* @__PURE__ */ new Set();
			let y = e._deferred;
			f || (e._deferred = []), function(e, t) {
				let n = e._decorators, r = e._pendingDecorators || n, i = t._nodeMap, a;
				for (a in r) i.has(a) || (r === n && (r = jc(e)), delete r[a]);
			}(e, n);
			let b = i ? null : bl(ll(e));
			if (e._editable && b !== null && (c || s === null || s.dirty || !s.is(o)) && r !== null && !v.has("skip-dom-selection")) {
				ko = e, Oo = n;
				try {
					if (p !== null && p.disconnect(), c || s === null || s.dirty) {
						let t = e._blockCursorElement;
						t !== null && yl(t, e, r), yo(o, s, e, b, v, r);
					}
					(function(e, t, n) {
						let r = e._blockCursorElement;
						if (P(n) && n.isCollapsed() && n.anchor.type === "element" && t.contains(Pl(t))) {
							let i = n.anchor, a = i.getNode(), o = i.offset, s = !1, c = null;
							if (o === a.getChildrenSize()) vl(a.getChildAtIndex(o - 1)) && (s = !0);
							else {
								let t = a.getChildAtIndex(o);
								t !== null && vl(t) && (s = !0, c = e.getElementByKey(t.__key));
							}
							if (s) {
								let n = Vl(a, e.getElementByKey(a.__key), e).element;
								r === null && (e._blockCursorElement = r = function(e) {
									let t = e.theme, n = Dl().createElement("div");
									n.contentEditable = "false", n.setAttribute("data-lexical-cursor", "true");
									let r = t.blockCursor;
									return r !== void 0 && (typeof r == "string" && (r = t.blockCursor = Nd(r)), r !== void 0 && n.classList.add(...r)), n;
								}(e._config)), t.style.caretColor = "transparent", c === null ? n.appendChild(r) : n.insertBefore(r, c);
								return;
							}
						}
						r !== null && yl(r, e, t);
					})(e, r, s);
				} finally {
					p !== null && p.observe(r, Io), ko = d, Oo = l;
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
			x !== null && (e._decorators = x, e._pendingDecorators = null, Zo("decorator", e, !0, x)), function(e, t, n) {
				let r = Mc(t), i = Mc(n);
				r !== i && Zo("textcontent", e, !0, i);
			}(e, t || a, n), Zo("update", e, !0, {
				dirtyElements: g,
				dirtyLeaves: h,
				editorState: n,
				mutatedNodes: m,
				normalizedNodes: _,
				prevEditorState: t || a,
				tags: v
			}), f || es(e, y), function(e) {
				let t = e._updates;
				if (t.length === 0) return void (e._cascadeCount = 0);
				if (function(e) {
					No.has(e) || (No.add(e), setTimeout(() => {
						No.delete(e), e._cascadeCount = 0;
					}, 0));
				}(e), e._cascadeCount++ > 99) return e._updates = [], e._cascadeCount = 0, void e._onWarn(ce(437, e._config.namespace));
				let n = t.shift();
				if (n) {
					let [t, r] = n;
					ns(e, t, r);
				}
			}(e);
		})(e, t), n && e._onWarn(ce(436));
	} finally {
		Mo = n;
	}
}
function Zo(e, t, n, ...r) {
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
function Qo(e, t) {
	let n = e._lastNotifiedSelection;
	return t === null ? n !== null : !t.is(n);
}
function $o(e, t, n, r) {
	let i = zc(e), a;
	if (!Mo) for (let e = 0; e < i.length; e++) i[e]._updating || (i[e]._cascadeCount = 0);
	if (t === rr) {
		if (ko !== e || Ao) {
			let i = !1;
			return rs(e, () => {
				i = $o(e, t, n, r);
			}), i;
		}
		let i = Bo()._selection;
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
				if (rs(s, () => {
					for (let i of t) if (i(n, r)) return void (e = !0);
				}), e) return e;
			}
		}
	}
	return a && a.update(() => {
		$o(a, t, n, r);
	}), !1;
}
function es(e, t) {
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
function ts(e, t) {
	let n = e._updates, r = t || !1;
	for (; n.length !== 0;) {
		let t = n.shift();
		if (t) {
			let [n, i] = t, a = e._pendingEditorState, o;
			i !== void 0 && (o = i.onUpdate, i.skipTransforms && (r = !0), i.discrete && (a === null && T(191), a._flushSync = !0), o && e._deferred.push(o), qo(e, i.tag)), a == null ? ns(e, n, i) : n();
		}
	}
	return r;
}
function ns(e, t, n, r = !1) {
	let i = e._updateTags, a, o = !1, s = !1;
	n !== void 0 && (a = n.onUpdate, qo(e, n.tag), o = n.skipTransforms || !1, s = n.discrete || !1), a && e._deferred.push(a);
	let c = e._editorState, l = e._pendingEditorState, u = !1;
	(l === null || l._readOnly) && (l = e._pendingEditorState = hs(l || c), u = !0), l._flushSync = s;
	let d = Oo, f = Ao, p = ko, m = e._updating;
	Oo = l, Ao = !1, e._updating = !0, ko = e;
	let h = e._headless || e.getRootElement() === null;
	ac(null);
	try {
		u && (h ? c._selection !== null && (l._selection = c._selection.clone()) : l._selection = function(e, t) {
			let n = e.getEditorState()._selection, r = bl(ll(e));
			return P(n) || n == null ? fo(n, r, e, t) : n.clone();
		}(e, n && n.event || null));
		let r = e._compositionKey;
		t(), o = ts(e, o), function(e, t) {
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
			let n = t._dirtyLeaves, r = t._dirtyElements, i = e._nodeMap, a = Ec(), o = /* @__PURE__ */ new Map(), s = n, c = s.size, l = r, u = l.size;
			for (; c > 0 || u > 0;) {
				if (c > 0) {
					t._dirtyLeaves = /* @__PURE__ */ new Set();
					for (let e of s) {
						let r = i.get(e);
						N(r) && r.isAttached() && r.isSimpleText() && !r.isUnmergeable() && nn(r), r !== void 0 && Ko(r, a) && Go(t, r, o), n.add(e);
					}
					if (s = t._dirtyLeaves, c = s.size, c > 0) {
						Fo++;
						continue;
					}
				}
				t._dirtyLeaves = /* @__PURE__ */ new Set(), t._dirtyElements = /* @__PURE__ */ new Map(), l.delete("root") && l.set("root", !0);
				for (let e of l) {
					let n = e[0], s = e[1];
					if (r.set(n, s), !s) continue;
					let c = i.get(n);
					c !== void 0 && Ko(c, a) && Go(t, c, o);
				}
				s = t._dirtyLeaves, c = s.size, l = t._dirtyElements, u = l.size, Fo++;
			}
			t._dirtyLeaves = n, t._dirtyElements = r;
		}(l, e), ts(e), function(e, t, n, r) {
			let i = e._nodeMap, a = t._nodeMap, o = [];
			for (let [e] of r) {
				let t = a.get(e);
				t !== void 0 && (t.isAttached() || (z(t) && rt(t, e, i, a, o, r), i.has(e) || r.delete(e), o.push(e)));
			}
			for (let e of n) {
				let t = a.get(e);
				t === void 0 || t.isAttached() || (Nu(t) && t.__slots !== null && rt(t, e, i, a, o, n), i.has(e) || n.delete(e), o.push(e));
			}
			let s = R(), c = s._cloneNotNeeded;
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
		e._lastNotifiedSelection = n === null ? null : n.clone(), e._dirtyType = 2, e._cloneNotNeeded.clear(), e._dirtyLeaves = /* @__PURE__ */ new Set(), e._dirtyElements.clear(), Xo(e);
		return;
	} finally {
		Oo = d, Ao = f, ko = p, e._updating = m, Fo = 0;
	}
	r || (e._dirtyType !== 0 || e._deferred.length > 0 || function(e, t) {
		let n = t.getEditorState()._selection, r = e._selection;
		if (r !== null) {
			if (r.dirty || !r.is(n)) return !0;
		} else if (n !== null) return !0;
		return !1;
	}(l, e) ? l._flushSync ? (l._flushSync = !1, Xo(e)) : u && uc(() => {
		Xo(e);
	}) : (l._flushSync = !1, u && (i.clear(), e._deferred = [], e._pendingEditorState = null)));
}
function rs(e, t, n) {
	ko === e && n === void 0 ? Lo() ? ns(e, t, n) : t() : ns(e, t, n);
}
function is() {
	return {
		...Ne,
		0: ""
	};
}
function as() {
	return {
		...je,
		"": 0
	};
}
var os = /* @__PURE__ */ is(), ss = /* @__PURE__ */ as(), cs = /* @__PURE__ */ Pt()({
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
		getterTable: os,
		setter: "setFormat",
		setterTable: ss
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
function ls(e) {
	if (pl(e)) {
		let t = null;
		for (let n of e.getChildren()) t = n.isInline() ? (t || n.replace(n.createParentElementNode())).append(n) : null;
	}
}
var us = class extends Wi {
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
			$transform: ls,
			extends: Wi,
			generated: ta,
			json: cs
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
		return this.getChildrenSize() === 0 && Vu(this).length === 0;
	}
	isDirty() {
		let e = R()._dirtyElements;
		return e !== null && e.has(this.__key);
	}
	isLastChild() {
		let e = this.getLatest(), t = this.getParentOrThrow().getLastChild();
		return t !== null && t.is(e);
	}
	getAllTextNodes() {
		let e = [];
		for (let t of Vu(this)) {
			let n = Hu(this, t);
			if (z(n)) for (let t of n.getAllTextNodes()) e.push(t);
		}
		let t = this.getFirstChild();
		for (; t !== null;) {
			if (N(t) && e.push(t), z(t)) for (let n of t.getAllTextNodes()) e.push(n);
			t = t.getNextSibling();
		}
		return e;
	}
	getFirstDescendant() {
		let e = this.getFirstChild();
		for (; z(e);) {
			let t = e.getFirstChild();
			if (t === null) break;
			e = t;
		}
		return e;
	}
	getLastDescendant() {
		let e = this.getLastChild();
		for (; z(e);) {
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
			return z(e) && e.getLastDescendant() || e || null;
		}
		let r = t[e];
		return z(r) && r.getFirstDescendant() || r || null;
	}
	getFirstChild() {
		let e = this.getLatest().__first;
		return e === null ? null : V(e);
	}
	getFirstChildOrThrow() {
		let e = this.getFirstChild();
		return e === null && T(45, this.__key), e;
	}
	getLastChild() {
		let e = this.getLatest().__last;
		return e === null ? null : V(e);
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
		let e = Ju(this), t = this.getChildren(), n = t.length;
		for (let r = 0; r < n; r++) {
			let i = t[r];
			e += i.getTextContent(), z(i) && r !== n - 1 && !i.isInline() && (e += De);
		}
		return e;
	}
	getTextContentSize() {
		let e = function(e) {
			let t = 0;
			for (let n of Vu(e)) {
				let r = Hu(e, n);
				r !== null && (t += r.getTextContentSize());
			}
			return t;
		}(this), t = this.getChildren(), n = t.length;
		for (let r = 0; r < n; r++) {
			let i = t[r];
			e += i.getTextContentSize(), z(i) && r !== n - 1 && !i.isInline() && (e += 2);
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
		return xc(this.getLatest().__textFormat, e, t);
	}
	getTextStyle() {
		return this.getLatest().__textStyle;
	}
	select(e, t) {
		Ro();
		let n = F(), r = e, i = t, a = this.getChildrenSize();
		if (!this.canBeEmpty()) {
			if (e === 0 && t === 0) {
				let e = this.getFirstChild();
				if (N(e) || z(e)) return e.select(0, 0);
			} else if (!(e !== void 0 && e !== a || t !== void 0 && t !== a)) {
				let e = this.getLastChild();
				if (N(e) || z(e)) return e.select();
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
				Cc(e.getWritable()), s.push(n), e = t;
			}
		}
		let d = l;
		for (let e of n) {
			d !== null && e.is(d) && (l = d = d.getPreviousSibling()), c !== null && e.is(c) && (c = c.getNextSibling());
			let t = e.getWritable();
			t.__parent === a && u--, Cc(t);
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
				ds(r, t, n) && _o(r, r.getNode(), this, l, c), ds(i, t, n) && _o(i, i.getNode(), this, l, c), u !== 0 || this.canBeEmpty() || pl(this) || this.remove();
			}
		}
		return i;
	}
	getDOMSlot(e) {
		return new Ge(e);
	}
	exportDOM(e) {
		let { element: t } = super.exportDOM(e);
		if (U(t)) {
			let e = this.getIndent();
			e > 0 && (t.style.paddingInlineStart = 40 * e + "px", t.setAttribute("data-lexical-indent", String(e)));
			let n = this.getDirection();
			n && (t.dir = n);
		}
		return { element: t };
	}
	shouldSerializeTextStyles() {
		if (pl(this)) return !1;
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
		let n = Vl(this, e, t), r = n.getFirstChild();
		for (let e = this.getFirstChild(); e; e = e.getNextSibling()) {
			let i = t.getElementByKey(e.getKey());
			i !== null && (r == null ? (n.insertChild(i), r = i) : r !== i && n.replaceChild(i, r), r = r.nextSibling);
		}
	}
};
function z(e) {
	return e instanceof us;
}
function ds(e, t, n) {
	let r = e.getNode();
	for (; r;) {
		let e = r.__key;
		if (t.has(e) && !n.has(e)) return !0;
		r = r.getParent();
	}
	return !1;
}
var fs = class extends Wi {
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
function B(e) {
	return e instanceof fs;
}
var ps = class extends us {
	__cachedText;
	$config() {
		return this.config("root", { extends: us });
	}
	constructor() {
		super("root"), this.__cachedText = null;
	}
	getTopLevelElementOrThrow() {
		T(51);
	}
	getTextContent() {
		let e = this.__cachedText;
		return e === null || !Lo() && R()._dirtyType !== 0 ? super.getTextContent() : e;
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
		for (let e of n) z(e) || B(e) || T(282);
		return super.splice(e, t, n);
	}
	static importJSON(e) {
		return Nc().updateFromJSON(e);
	}
	collapseAtStart() {
		return !0;
	}
};
function ms(e) {
	return e instanceof ps;
}
function hs(e) {
	return new ys(Ze(e._nodeMap), null, e._slotsUsed);
}
function gs() {
	return new ys(/* @__PURE__ */ new Map([["root", new ps()]]), null, !1);
}
function _s(e) {
	let t = e.constructor, n = nt(e);
	if (z(e)) {
		let t = n.children, r = e.getChildren();
		for (let e = 0; e < r.length; e++) t.push(_s(r[e]));
	}
	let r = Vu(e);
	if (r.length > 0) {
		let i = {};
		for (let n of r) {
			let r = Hu(e, n);
			r === null && T(366, t.name, n), i[n] = _s(r);
		}
		n.$slots = i;
	}
	return n;
}
function vs(e) {
	return e instanceof ys;
}
var ys = class e {
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
		return Yo(t && t.editor || null, this, e);
	}
	clone(t) {
		let n = new e(this._nodeMap, t === void 0 ? this._selection : t, this._slotsUsed);
		return n._readOnly = !0, n._parsed = this._parsed, n;
	}
	toJSON(e) {
		return et(typeof e == "boolean" && e, () => Yo(null, this, () => ({ root: _s(Nc()) })));
	}
}, bs = class extends us {
	$config() {
		return this.config("artificial", { extends: us });
	}
	createDOM(e) {
		return Dl().createElement("div");
	}
}, xs = class extends Wi {
	$config() {
		return this.config("linebreak", {
			extends: Wi,
			generated: aa,
			importDOM: { br: (e) => Ts(e) || Es(e) ? null : {
				conversion: Ss,
				priority: 0
			} }
		});
	}
	getTextContent() {
		return "\n";
	}
	createDOM() {
		return Dl().createElement("br");
	}
	updateDOM() {
		return !1;
	}
	isInline() {
		return !0;
	}
};
function Ss(e) {
	return { node: Cs() };
}
function Cs() {
	return hl(new xs());
}
function ws(e) {
	return e instanceof xs;
}
function Ts(e) {
	let t = e.parentElement;
	if (t !== null && G(t)) {
		let n = t.firstChild;
		if (n === e || n.nextSibling === e && Ds(n)) {
			let n = t.lastChild;
			if (n === e || n.previousSibling === e && Ds(n)) return !0;
		}
	}
	return !1;
}
function Es(e) {
	let t = e.parentElement;
	if (t !== null && G(t)) {
		let n = t.firstChild;
		if (n === e || n.nextSibling === e && Ds(n)) return !1;
		let r = t.lastChild;
		if (r === e || r.previousSibling === e && Ds(r)) return !0;
	}
	return !1;
}
function Ds(e) {
	return vc(e) && /^( |\t|\r?\n)+$/.test(e.textContent || "");
}
function Os(e, t) {
	let { type: n, key: r, offset: i } = e, a = _l(e.key);
	return n === "text" ? (N(a) || T(266, a.getType(), r), pd(a, t, i)) : (z(a) || T(267, a.getType(), r), Bs(a, e.offset, t));
}
function ks(e, t) {
	let { origin: n, direction: r } = t, i = r === "next";
	od(t) ? e.set(n.getKey(), t.offset, "text") : sd(t) ? N(n) ? e.set(n.getKey(), md(n, r), "text") : e.set(n.getParentOrThrow().getKey(), n.getIndexWithinParent() + +!!i, "element") : (cd(t) && z(n) || T(268), e.set(n.getKey(), i ? 0 : n.getChildrenSize(), "element"));
}
function As(e) {
	let t = F(), n = P(t) ? t : lo();
	return js(n, e), Fc(n), n;
}
function js(e, t) {
	ks(e.anchor, t.anchor), ks(e.focus, t.focus);
}
function Ms(e) {
	let { anchor: t, focus: n } = e, r = Os(t, "next"), i = Os(n, "next"), a = Td(r, i) <= 0 ? "next" : "previous";
	return Cd(xd(r, a), xd(i, a));
}
function Ns(e) {
	let { direction: t, origin: n } = e, r = fd(n, nd(t)).getNodeAtCaret();
	return r ? fd(r, t) : gd(n.getParentOrThrow(), t);
}
function Ps(e, t = "root") {
	let n = [e];
	for (let r = cd(e) ? e.getParentCaret(t) : e.getSiblingCaret(); r !== null; r = r.getParentCaret(t)) n.push(Ns(r));
	return n;
}
function Fs(e) {
	return !!e && e.origin.isAttached();
}
function Is(e, t = "removeEmptySlices") {
	if (e.isCollapsed()) return e;
	let n = "root", r = "next", i = t, a = zs(e, r), o = a.anchor.origin;
	for (; o !== null && !pl(o);) o = o.getParent();
	let s = z(o) ? o.getFirstChild() : null, c = Ps(a.anchor, n), l = Ps(a.focus.getFlipped(), n), u = /* @__PURE__ */ new Set(), d = [];
	for (let e of a.iterNodeCarets(n)) if (cd(e)) u.add(e.origin.getKey());
	else if (sd(e)) {
		let { origin: t } = e;
		z(t) && !u.has(t.getKey()) || d.push(t);
	}
	let f = /* @__PURE__ */ new Set();
	for (let e of d) {
		let t = e.getParent();
		t === null || u.has(t.getKey()) || f.add(t), Cc(e);
	}
	for (let e of f) !e.canBeEmpty() && !pl(e) && e.isEmpty() && e.isAttached() && e.remove();
	for (let e of a.getTextSlices()) {
		if (!e) continue;
		let { origin: t } = e.caret, n = t.getTextContentSize(), a = Ns(fd(t, r)), o = t.getMode();
		if (Math.abs(e.distance) === n && i === "removeEmptySlices" || o === "token" && e.distance !== 0) a.remove();
		else if (e.distance !== 0) {
			i = "removeEmptySlices";
			let t = e.removeTextSlice(), n = e.caret.origin;
			if (o === "segmented") {
				let e = t.origin, n = Da(e.getTextContent()).setStyle(e.getStyle()).setFormat(e.getFormat());
				a.replaceOrInsert(n), t = pd(n, r, t.offset);
			}
			n.is(c[0].origin) && (c[0] = t), n.is(l[0].origin) && (l[0] = t.getFlipped());
		}
	}
	let p, m;
	for (let e of c) if (Fs(e)) {
		p = Ls(e);
		break;
	}
	for (let e of l) if (Fs(e)) {
		m = Ls(e);
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
				if (pl(i)) return;
				!n && t(i) && (n = i);
			}
			return n;
		}, u = l(a, K), d = u && l(o, (e) => n.has(e.getKey()) && K(e));
		return d && Vu(d).length > 0 ? null : u && d ? [u, d] : null;
	}(p, m, u);
	if (h) {
		let [e, t] = h;
		gd(e, "previous").splice(0, t.getChildren());
		let n = t.getParent();
		for (t.remove(!0); n && n.isEmpty();) {
			let e = n;
			n = n.getParent(), e.remove(!0);
		}
	} else if (m) {
		let e = function(e) {
			if (cd(e)) {
				let t = e.origin;
				if (K(t)) return t;
			} else {
				let t = e.getParentAtCaret();
				if (t && K(t)) return t;
			}
			return null;
		}(m), t = e && e.getParent(), n = e && e.getParents().findLast(fl);
		if (e && t && !ms(t) && e.isEmpty() && u.has(e.getKey()) && Vu(e).length === 0 && (!n || u.has(n.getKey()))) {
			e.remove(!0);
			let n = t;
			for (; n && !ms(n) && n.isEmpty();) {
				let e = n.getParent();
				if (e && ms(e) && e.getChildrenSize() <= 1 && n.canBeEmpty()) break;
				let t = n;
				n = e, t.remove(!0);
			}
		}
	}
	Pc(o, s) !== null || o === null || o.isAttached() || Pc(Nc(), null);
	let g = [
		p,
		m,
		...c,
		...l
	].find(Fs);
	if (g) return Sd(xd(Ls(g), e.direction));
	T(269, JSON.stringify(c.map((e) => e.origin.__key)));
}
function Ls(e) {
	let t = function(e) {
		let t = e;
		for (; cd(t);) {
			let e = vd(t);
			if (!cd(e)) break;
			t = e;
		}
		return t;
	}(e.getLatest()), { direction: n } = t;
	if (N(t.origin)) return od(t) ? t : pd(t.origin, n, n);
	let r = t.getAdjacentCaret();
	return sd(r) && N(r.origin) ? pd(r.origin, n, nd(n)) : t;
}
function Rs(e) {
	return od(e) && e.offset !== md(e.origin, e.direction);
}
function zs(e, t) {
	return e.direction === t ? e : Cd(xd(e.focus, t), xd(e.anchor, t));
}
function Bs(e, t, n) {
	let r = gd(e, "next");
	for (let e = 0; e < t; e++) {
		let e = r.getAdjacentCaret();
		if (e === null) break;
		r = e;
	}
	return xd(r, n);
}
function Vs(e) {
	let { origin: t, offset: n, direction: r } = e;
	if (n === md(t, r)) return e.getSiblingCaret();
	if (n === md(t, nd(r))) return Ns(e.getSiblingCaret());
	let [i] = t.splitText(n);
	return N(i) || T(281), xd(fd(i, "next"), r);
}
function Hs(e, t) {
	return !0;
}
function Us(e, { $copyElementNode: t = ml, $splitTextPointCaretNext: n = Vs, rootMode: r = "shadowRoot", $shouldSplit: i = Hs, removeEmptyDestination: a = !1 } = {}) {
	if (od(e)) return n(e);
	let o = e.getParentCaret(r);
	if (o) {
		let { origin: n } = o;
		if (cd(e)) {
			let e = Ns(o);
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
function Ws(e, t, n) {
	let r = xd(t, "next");
	od(r) && (r.offset === 0 ? r = fd(r.origin, "previous").getFlipped() : r.offset === r.origin.getTextContentSize() && (r = fd(r.origin, "next"))), r.origin.is(e) && (sd(r) || T(342, e.getKey(), e.getType()), r = Ns(r)), (e.is(r.getNodeAtCaret()) || e.is(r.getFlipped().getNodeAtCaret())) && e.remove(!0);
	for (let e = r; e; e = Us(e, n)) r = e;
	return od(r) && T(283), r.insert(e.isInline() ? Js().append(e) : e), xd(fd(e.getLatest(), "next"), t.direction);
}
function Gs(e, t) {
	let n = zs(P(t) ? Ms(t) : t, "next"), r = Ru(n.anchor.origin), i = Ru(e.getLatest());
	if (r === null ? i !== null : !r.is(i)) return !1;
	let a = Ls(gd(e, "next")), o = xd(Ls(gd(e, "previous")), "next");
	return Td(n.anchor, a) <= 0 && Td(n.focus, o) >= 0;
}
var Ks = class extends us {
	$config() {
		return this.config("paragraph", {
			extends: us,
			generated: ia,
			importDOM: { p: () => ({
				conversion: qs,
				priority: 0
			}) }
		});
	}
	createDOM(e) {
		let t = Dl().createElement("p"), n = Yc(e.theme, "paragraph");
		return n !== void 0 && t.classList.add(...n), t;
	}
	updateDOM(e, t, n) {
		return !1;
	}
	exportDOM(e) {
		let { element: t } = super.exportDOM(e);
		if (U(t)) {
			this.isEmpty() && t.append(Dl().createElement("br"));
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
		if (Gs(this, t)) {
			let e = this.getTextContent();
			return e !== "" && t.getTextContent() === e;
		}
		return !1;
	}
	insertNewAfter(e, t) {
		let n = Js();
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
function qs(e) {
	let t = Js();
	if (Zl(t, e), Yl(e, t), t.getFormatType() === "") {
		let n = e.getAttribute("align");
		n && n && n in je && t.setFormat(n);
	}
	return Xl(t, e), { node: t };
}
function Js() {
	return hl(new Ks());
}
function Ys(e) {
	return e instanceof Ks;
}
function Xs(e) {
	console.warn(e);
}
function Zs(e, t, n, r, i) {
	let a = e._keyToDOMMap;
	a.clear(), e._editorState = gs(), e._pendingEditorState = r, e._compositionKey = null, e._dirtyType = 0, e._cloneNotNeeded.clear(), e._dirtyLeaves = /* @__PURE__ */ new Set(), e._dirtyElements.clear(), e._normalizedNodes = /* @__PURE__ */ new Set(), i && i.preserveUpdateQueue || (e._updateTags = /* @__PURE__ */ new Set(), e._updates = [], e._cascadeCount = 0), e._blockCursorElement = null, e._inputState.handledSelectionCommandTimeoutId !== null && clearTimeout(e._inputState.handledSelectionCommandTimeoutId), e._inputState = {
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
	}(t, e)), n !== null && (n.textContent = "", a.set("root", n), Oc(n, e, "root"));
}
function Qs(e) {
	let t = /* @__PURE__ */ new Set(), n = /* @__PURE__ */ new Set();
	for (let { klass: r, ownNodeConfig: i } of Du(e)) {
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
var $s = {
	$createDOM: (e, t) => e.createDOM(t._config, t),
	$decorateDOM: (e, t, n, r) => {},
	$exportDOM: (e, t) => {
		let n = lc(t, e.getType());
		return n && n.exportDOM !== void 0 ? n.exportDOM(t, e) : e.exportDOM(t);
	},
	$extractWithChild: (e, t, n, r, i) => z(e) && e.extractWithChild(t, n, r),
	$getDOMSlot: (e, t, n) => e.getDOMSlot(t),
	$getSlotTargetElement: (e, t, n, r) => null,
	$shouldExclude: (e, t, n) => z(e) && e.excludeFromCopy("html"),
	$shouldInclude: (e, t, n) => !t || e.isSelected(t),
	$updateDOM: (e, t, n, r) => e.updateDOM(t, n, r._config)
};
function ec(e) {
	let t = e || {}, n = Wo(), r = t.theme || {}, i = e === void 0 ? n : t.parentEditor || null, a = t.disableEvents || !1, o = gs(), s = t.namespace || (i === null ? Bc() : i._config.namespace), c = t.editorState, l = [
		ps,
		va,
		xs,
		Aa,
		Ks,
		bs,
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
			Su(n);
			let a = n.getType(), o = Qs(n);
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
	let h = new rc(o, i, m, {
		disableEvents: a,
		dom: {
			...$s,
			...e && e.dom
		},
		namespace: s,
		theme: r
	}, u || console.error, d || Xs, function(e, t) {
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
function tc(e, t) {
	let n = e.get(t);
	e.delete(t), n && n();
}
function nc(e, t, n) {
	return e.set(t, n), tc.bind(null, e, t);
}
var rc = class {
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
		}, this._commands = /* @__PURE__ */ new Map(), this._config = r, this._nodes = n, this._decorators = {}, this._pendingDecorators = null, this._dirtyType = 0, this._cloneNotNeeded = /* @__PURE__ */ new Map(), this._dirtyLeaves = /* @__PURE__ */ new Set(), this._dirtyElements = /* @__PURE__ */ new Map(), this._normalizedNodes = /* @__PURE__ */ new Set(), this._updateTags = /* @__PURE__ */ new Set(), this._observer = null, this._key = Bc(), this._onError = i, this._onWarn = a, this._htmlConversions = o, this._editable = s, this._headless = t !== null && t._headless, this._window = null, this._blockCursorElement = null, this._slotsUsed = !1, this._keyDownShortcuts = null, this._inputState = {
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
		return nc(this._listeners.update, e);
	}
	registerEditableListener(e) {
		return nc(this._listeners.editable, e);
	}
	registerDecoratorListener(e) {
		return nc(this._listeners.decorator, e);
	}
	registerTextContentListener(e) {
		return nc(this._listeners.textcontent, e);
	}
	registerRootListener(e) {
		let t = this._listeners.root;
		return Pd(nc(t, e, e(this._rootElement, null) || void 0), () => function(e, t, n) {
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
		let n = this._editorState, r = Kl(n).get(t.getType());
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
			let n = Kl(e.getEditorState()), r = [];
			for (let e of t) {
				let t = n.get(e);
				t && r.push(t);
			}
			r.length !== 0 && e.update(() => {
				for (let e of r) for (let t of e.keys()) {
					let e = V(t);
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
		return H(this, e, ...t);
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
			let n = Yc(this._config.theme, "root"), r = this._pendingEditorState || this._editorState;
			if (this._rootElement = e, Zs(this, t, e, r, { preserveUpdateQueue: !0 }), t !== null && (this._config.disableEvents || function(e) {
				let t = ii.get(e);
				if (t === void 0) return void Bi();
				let n = ai.get(t);
				if (n === void 0) return void Bi();
				ii.delete(e);
				let r = hc(e);
				pc(r) ? (function(e) {
					if (e._parentEditor !== null) {
						let t = zc(e), n = t[t.length - 1]._key;
						Ii.get(n) === e && Ii.delete(n);
					} else Ii.delete(e._key);
				}(r), n.editors.delete(r), n.hasShadowEditor = void 0, e.__lexicalEditor = null) : r && T(198);
				let i = Fi(e);
				for (let e = 0; e < i.length; e++) i[e]();
				e.__lexicalEventHandles = [];
			}(t), n != null && t.classList.remove(...n)), e !== null) {
				let t = cl(e), r = e.style;
				r.userSelect = "text", r.whiteSpace = "pre-wrap", r.wordBreak = "break-word", e.setAttribute("data-lexical-editor", "true"), this._window = t, this._dirtyType = 2, pt(this), this._updateTags.add(qi), Xo(this), this._config.disableEvents || function(e, t) {
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
							n === "deleteCompositionText" || O && $c(t) || n !== "insertCompositionText" && rs(t, () => {
								vi(e, t) || H(t, ar, e);
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
								case "cut": return n && H(t, Rr, e);
								case "copy": return H(t, Lr, e);
								case "paste": return n && H(t, pr, e);
								case "dragstart": return n && H(t, Pr, e);
								case "dragover": return n && H(t, Fr, e);
								case "dragend": return n && H(t, Ir, e);
								case "focus": return n && H(t, Wr, e);
								case "blur": return t._inputState.isShiftKeyDown = !1, t._inputState.isInsertLineBreak = !1, n && H(t, Gr, e);
								case "drop": return n && H(t, Nr, e);
							}
						};
						i.push(ti(e, r, s));
					}
				}(e, this), n != null && e.classList.add(...n);
			} else this._window = null, this._updateTags.add(qi), Xo(this);
			Zo("root", this, !1, e, t);
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
		r._readOnly && (r = hs(e), r._selection = e._selection ? e._selection.clone() : null), ft(this);
		let i = this._pendingEditorState, a = t === void 0 ? null : t.tag;
		i === null || i.isEmpty() || (a != null && this._updateTags.add(a), Xo(this)), this._pendingEditorState = r, this._dirtyType = 2, this._dirtyElements.set("root", !1), this._compositionKey = null, this._slotsUsed = this._slotsUsed || e._slotsUsed, rs(this, () => {
			if (a && this._updateTags.add(a), n && (le(38), Nc().append(Js())), e._parsed) for (let [e, t] of r._nodeMap.entries()) z(t) ? this._dirtyElements.set(e, !0) : this._dirtyLeaves.add(e);
		}, { discrete: !this._updating || void 0 });
	}
	parseEditorState(e, t) {
		return function(e, t, n) {
			let r = gs(), i = Oo, a = Ao, o = ko, s = t._dirtyElements, c = t._dirtyLeaves, l = t._cloneNotNeeded, u = t._dirtyType;
			t._dirtyElements = /* @__PURE__ */ new Map(), t._dirtyLeaves = /* @__PURE__ */ new Set(), t._cloneNotNeeded = /* @__PURE__ */ new Map(), t._dirtyType = 0, Oo = r, Ao = !1, ko = t, ac(null);
			try {
				let i = t._nodes;
				Jo(e.root, i), n && n(), r._readOnly = !0, r._parsed = !0;
			} catch (e) {
				e instanceof Error && t._onError(e);
			} finally {
				t._dirtyElements = s, t._dirtyLeaves = c, t._cloneNotNeeded = l, t._dirtyType = u, Oo = i, Ao = a, ko = o;
			}
			return r;
		}(typeof e == "string" ? JSON.parse(e) : e, this, t);
	}
	read(...e) {
		let [t, n] = e.length === 1 ? ["force-commit", e[0]] : e;
		return t === "force-commit" && Xo(this), (t === "pending" ? this._pendingEditorState || this._editorState : this.getEditorState()).read(n, { editor: this });
	}
	update(e, t) {
		(function(e, t, n) {
			e._updating ? e._updates.push([t, n]) : ns(e, t, n);
		})(this, e, t);
	}
	focus(e, t = {}) {
		let n = this._rootElement;
		n !== null && (n.setAttribute("autocapitalize", "off"), rs(this, () => {
			let r = F(), i = Nc();
			r === null ? i.getChildrenSize() !== 0 && (t.defaultSelection === "rootStart" ? i.selectStart() : i.selectEnd()) : r.dirty || Fc(r.clone()), al("focus"), ol(() => {
				n.removeAttribute("autocapitalize"), e && e();
			});
		}), this._pendingEditorState === null && n.removeAttribute("autocapitalize"));
	}
	blur() {
		let e = this._rootElement;
		e !== null && e.blur();
		let t = bl(this._window);
		t !== null && t.removeAllRanges();
	}
	isEditable() {
		return this._editable;
	}
	setEditable(e) {
		this._editable !== e && (this._editable = e, Zo("editable", this, !0, e), this._slotsUsed && this.update(() => Ho()));
	}
	toJSON() {
		return { editorState: this._editorState.toJSON(tt()) };
	}
}, ic = null;
function ac(e) {
	ic = e;
}
var oc = Symbol("INTERNAL_SKIP_AFTER_CLONE_FROM"), sc = 1;
function cc(e, t) {
	let n = lc(e, t);
	return n === void 0 && T(30, t), n;
}
function lc(e, t) {
	return e._nodes.get(t);
}
var uc = typeof queueMicrotask == "function" ? queueMicrotask : (e) => {
	Promise.resolve().then(e);
};
function dc(e, t) {
	let n = t === void 0 ? (() => {
		let t = e.getRootNode();
		return yc(t) || Sl(t) ? Fl(t) : null;
	})() : t;
	if (!U(n) || n.hasAttribute("data-lexical-slot")) return !1;
	let r = Ac(n), i = n.nodeName;
	return Gi(r) && (i === "INPUT" || i === "TEXTAREA" || n.contentEditable === "true" && hc(n) == null);
}
function fc(e, t, n) {
	let r = e.getRootElement();
	if (!r) return !1;
	try {
		if (!t || !r.contains(t) || !r.contains(n)) return !1;
	} catch {
		return !1;
	}
	return mc(t) === e && e.read("latest", () => !dc(t));
}
function pc(e) {
	return e instanceof rc;
}
function mc(e) {
	let t = e;
	for (; t != null;) {
		let e = hc(t);
		if (pc(e)) return e;
		t = tl(t);
	}
	return null;
}
function hc(e) {
	return e ? e.__lexicalEditor : null;
}
function gc(e) {
	return Ma(e) || e.isToken();
}
function _c(e) {
	return gc(e) || e.isSegmented();
}
function vc(e) {
	return Ll(e) && e.nodeType === 3;
}
function yc(e) {
	return Ll(e) && e.nodeType === 9;
}
function bc(e) {
	let t = e;
	for (; t != null;) {
		if (vc(t)) return t;
		t = t.firstChild;
	}
	return null;
}
function xc(e, t, n) {
	let r = ke[t];
	if (n !== null && (e & r) === (n & r)) return e;
	let i = e ^ r;
	return t === "subscript" ? i &= ~ke.superscript : t === "superscript" ? i &= ~ke.subscript : t === "lowercase" ? (i &= ~ke.uppercase, i &= ~ke.capitalize) : t === "uppercase" ? (i &= ~ke.lowercase, i &= ~ke.capitalize) : t === "capitalize" && (i &= ~ke.lowercase, i &= ~ke.uppercase), i;
}
function Sc(e, t) {
	let n = function() {
		let e = ic;
		return ic = null, e;
	}();
	if ((t ||= n && n.__key) != null) return void (e.__key = t);
	Ro(), zo();
	let r = R(), i = Bo(), a = "" + sc++;
	i._nodeMap.set(a, e), z(e) ? r._dirtyElements.set(a, !0) : r._dirtyLeaves.add(a), r._cloneNotNeeded.set(a, e), r._dirtyType === 0 && (r._dirtyType = 1), e.__key = a;
}
function Cc(e) {
	Fu(e) !== null && T(380, e.__key, String(Fu(e)));
	let t = e.getParent();
	if (t !== null) {
		let n = e.getWritable(), r = t.getWritable(), i = e.getPreviousSibling(), a = e.getNextSibling(), o = a === null ? null : a.__key, s = i === null ? null : i.__key, c = i === null ? null : i.getWritable(), l = a === null ? null : a.getWritable();
		i === null && (r.__first = o), a === null && (r.__last = s), c !== null && (c.__next = o), l !== null && (l.__prev = s), n.__prev = null, n.__next = null, n.__parent = null, r.__size--;
	}
}
function wc(e) {
	zo(), Hi(e) && T(323, e.__key, e.__type);
	let t = e.__parent === null ? Pu(e) ? e.__slotHost : null : e.__parent, n = Bo(), r = R(), i = n._nodeMap, a = r._dirtyElements;
	t !== null && function(e, t, n) {
		let r = e;
		for (; r !== null;) {
			if (n.has(r)) return;
			let e = t.get(r);
			if (e === void 0) break;
			n.set(r, !1), r = e.__parent === null ? Pu(e) ? e.__slotHost : null : e.__parent;
		}
	}(t, i, a);
	let o = e.__key;
	r._dirtyType === 0 && (r._dirtyType = 1), z(e) ? a.set(o, !0) : r._dirtyLeaves.add(o);
}
function Tc(e) {
	Ro();
	let t = R(), n = t._compositionKey;
	if (e !== n) {
		if (t._compositionKey = e, n !== null) {
			let e = V(n);
			e !== null && e.getWritable();
		}
		if (e !== null) {
			let t = V(e);
			t !== null && t.getWritable();
		}
	}
}
function Ec() {
	return Lo() ? null : R()._compositionKey;
}
function V(e, t) {
	let n = (t || Bo())._nodeMap.get(e);
	return n === void 0 ? null : n;
}
function Dc(e, t) {
	let n = kc(e, R());
	return n === void 0 ? null : V(n, t);
}
function Oc(e, t, n) {
	e[`__lexicalKey_${t._key}`] = n;
}
function kc(e, t) {
	return e[`__lexicalKey_${t._key}`];
}
function Ac(e, t) {
	let n = e;
	for (; n != null;) {
		let e = Dc(n, t);
		if (e !== null) return e;
		n = tl(n);
	}
	return null;
}
function jc(e) {
	let t = e._decorators, n = Object.assign({}, t);
	return e._pendingDecorators = n, n;
}
function Mc(e) {
	return e.read(() => Nc().getTextContent());
}
function Nc() {
	return Bo()._nodeMap.get("root");
}
function Pc(e, t) {
	if (!(pl(e) && e.isAttached() && (ms(e) ? e.getChildrenSize() === 0 : e.isEmpty()) && (ms(e) || t !== null && K(t)))) return null;
	let n = Js();
	return e.append(n), n;
}
function Fc(e) {
	Ro();
	let t = Bo();
	e !== null && (e.dirty = !0, e.setCachedNodes(null), P(e) && R()._slotsUsed && ao(e)), t._selection = e;
}
function Ic() {
	Ro(), ft(R());
}
function Lc(e) {
	let t = function(e, t) {
		let n = e;
		for (; n != null;) {
			let e = kc(n, t);
			if (e !== void 0) return e;
			n = tl(n);
		}
		return null;
	}(e, R());
	return t === null ? null : V(t);
}
function Rc(e) {
	return /[\uD800-\uDBFF][\uDC00-\uDFFF]/g.test(e);
}
function zc(e) {
	let t = [];
	for (let n = e; n !== null; n = n._parentEditor) t.push(n);
	return t;
}
function Bc() {
	return Math.random().toString(36).replace(/[^a-z]+/g, "").substring(0, 5);
}
function Vc(e) {
	return vc(e) ? e.nodeValue : null;
}
function Hc(e, t, n) {
	let r = bl(ll(t));
	if (r === null) return;
	let i = Al(r, t._rootElement), a = i.anchorNode, { anchorOffset: o, focusOffset: s } = i;
	if (a !== null) {
		let t = Vc(a), r = Ac(a);
		if (t !== null && N(r)) {
			if ((t === Ee || t === Oe) && n) {
				let e = n.length;
				t = n, o = e, s = e;
			}
			t !== null && Uc(r, t, o, s, e);
		}
	}
}
function Uc(e, t, n, r, i) {
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
				if (Tc(null), be || ve || Ce) a.remove();
				else {
					let e = R();
					Wc(a, "", t), setTimeout(() => {
						e.update(() => {
							a.isAttached() && a.getTextContent() === "" && a.remove();
						});
					}, 20);
				}
				return;
			}
			let i = a.getParent(), c = po(), l = a.getTextContentSize(), u = Ec(), d = a.getKey();
			if (a.isToken() && !o || u !== null && d === u && !o || P(c) && (i !== null && !i.canInsertTextBefore() && c.anchor.offset === 0 || c.anchor.key === e.__key && c.anchor.offset === 0 && !a.canInsertTextBefore() && !o || c.focus.key === e.__key && c.focus.offset === l && !a.canInsertTextAfter() && !o)) return void a.markDirty();
			if (!P(t) || n === null || r === null) return void Wc(a, s, t);
			if (t.setTextNodeRange(a, n, a, r), a.isSegmented()) {
				let e = Da(a.getTextContent());
				a.replace(e), a = e;
			}
			Wc(a, s, t);
		}
	}
}
function Wc(e, t, n) {
	if (e.setTextContent(t), P(n)) {
		let t = e.getKey(), r = !1;
		for (let i of ["anchor", "focus"]) {
			let a = n[i];
			a.type === "text" && a.key === t && (a.offset = md(e, a.offset, "clamp"), r = !0);
		}
		r && (n._cachedNodes = null, n._cachedIsBackward = null);
	}
}
function Gc(e) {
	let t = e;
	for (; t !== null;) {
		let e = t.getParent();
		if (e === null) return null;
		if (ms(e)) return t;
		t = e;
	}
	return null;
}
function Kc(e, t) {
	let { anchor: n, focus: r } = e, i = n.key, a = n.offset, o = n.type, s = r.key, c = r.offset, l = r.type;
	if (rn(e), !ms(t)) return e;
	let u = Gc(n.getNode());
	return z(u) && u.isShadowRoot() && u.is(Gc(r.getNode())) && (n.set(i, a, o), r.set(s, c, l)), e;
}
function qc(e) {
	let t = Nc();
	if (P(e)) {
		let t = e.anchor, n = e.focus, r = t.getNode();
		if (ms(r)) return t.set(r.getKey(), 0, "element"), n.set(r.getKey(), r.getChildrenSize(), "element"), Kc(e, r), e;
		let i = r.getTopLevelElementOrThrow(), a = i.getParent();
		return a === null ? (z(i) && (t.set(i.getKey(), 0, "element"), n.set(i.getKey(), i.getChildrenSize(), "element"), Kc(e, i)), e) : (t.set(a.getKey(), 0, "element"), n.set(a.getKey(), a.getChildrenSize(), "element"), Kc(e, a), e);
	}
	{
		let e = t.select(0, t.getChildrenSize());
		return Fc(Kc(e, t)), e;
	}
}
function Jc(e, t) {
	e.getAttribute(t) === "" && e.removeAttribute(t);
}
function Yc(e, t) {
	e.__lexicalClassNameCache === void 0 && (e.__lexicalClassNameCache = {});
	let n = e.__lexicalClassNameCache, r = n[t];
	if (r !== void 0) return r;
	let i = e[t];
	if (typeof i == "string") {
		let e = Nd(i);
		return n[t] = e, e;
	}
	return i;
}
function Xc(e, t, n, r, i) {
	if (n.size === 0) return;
	let a = r.__type, o = r.__key, s = t.get(a);
	s === void 0 && T(33, a);
	let c = s.klass, l = e.get(c);
	l === void 0 && (l = /* @__PURE__ */ new Map(), e.set(c, l));
	let u = l.get(o), d = u === "destroyed" && i === "created";
	(u === void 0 || d) && l.set(o, d ? "updated" : i);
}
function Zc(e, t, n) {
	let r = e.getParent(), i = n, a = e;
	return r !== null && (t && n === 0 ? (i = a.getIndexWithinParent(), a = r) : t || n !== a.getChildrenSize() || (i = a.getIndexWithinParent() + 1, a = r)), a.getChildAtIndex(t ? i - 1 : i);
}
function Qc(e, t) {
	let n = e.offset;
	if (e.type === "element") return Zc(e.getNode(), t, n);
	{
		let r = e.getNode();
		if (t && n === 0 || !t && n === r.getTextContentSize()) {
			let e = t ? r.getPreviousSibling() : r.getNextSibling();
			return e === null ? Zc(r.getParentOrThrow(), t, r.getIndexWithinParent() + +!t) : e;
		}
	}
	return null;
}
function $c(e) {
	let t = ll(e).event, n = t && t.inputType;
	return n === "insertFromPaste" || n === "insertFromPasteAsQuotation";
}
function H(e, t, ...n) {
	return $o(e, t, n[0], e);
}
function el(e, t) {
	let n = e._keyToDOMMap.get(t);
	return n === void 0 && T(75, t), n;
}
function tl(e) {
	let t = e.assignedSlot || e.parentElement;
	if (t !== null) return t;
	let n = e.parentNode;
	return Sl(n) ? n.host : null;
}
function nl(e) {
	return yc(e) ? e : U(e) ? e.ownerDocument : null;
}
function rl(e, t) {
	let n = parseFloat(e);
	return isFinite(n) ? e.endsWith("%") ? n * t / 100 : n : 0;
}
function il(e, t, n, r) {
	let i = t.clientWidth, a = t.scrollWidth - i;
	if (a <= 0) return 0;
	let o = e.getComputedStyle(t);
	if (o.overflowX !== "auto" && o.overflowX !== "scroll") return 0;
	let s = t.getBoundingClientRect(), c = t.offsetWidth, l = c > 0 && Math.abs(s.width - c) > 1 ? s.width / c : 1, u = o.direction === "rtl", d = s.left + t.clientLeft * l, f = d + rl(o.scrollPaddingLeft, i) * l, p = d + (i - rl(o.scrollPaddingRight, i)) * l, m = n, h = Math.max(r, n + 1);
	h - m > p - f && (u ? m = h - 1 : h = m + 1);
	let g = 0;
	if (m < f ? g = m - f : h > p && (g = h - p), g === 0) return 0;
	let _ = t.scrollLeft, v = _ + g / l, y = g > 0 ? Math.ceil(v) : Math.floor(v), b = u ? Math.min(0, Math.max(-a, y)) : Math.max(0, Math.min(a, y)), x = _ * l;
	return Math.abs(b) < Math.abs(_) && m + x >= f && h + x <= p && (b = 0), b === _ ? 0 : (t.scrollLeft = b, (t.scrollLeft - _) * l);
}
function al(e) {
	Ro(), R()._updateTags.add(e);
}
function ol(e) {
	Ro(), R()._deferred.push(e);
}
function sl(e, t) {
	let n = e.getParent();
	for (; n !== null;) {
		if (n.is(t)) return !0;
		n = n.getParent();
	}
	return !1;
}
function cl(e) {
	let t = nl(e);
	return t ? t.defaultView : null;
}
function ll(e) {
	let t = e._window;
	return t === null && T(78), t;
}
function ul(e) {
	return z(e) && e.isInline() || B(e) && e.isInline();
}
function dl(e) {
	let t = e.getLatest();
	for (; t !== null;) {
		if (Fu(t) !== null && z(t)) return t;
		let e = t.getParentOrThrow();
		if (pl(e)) return e;
		t = e;
	}
	return t;
}
function fl(e) {
	return z(e) && e.isShadowRoot();
}
function pl(e) {
	return ms(e) || fl(e);
}
function ml(e, t = !1) {
	let n = e.constructor.clone(e, oc);
	return Sc(n, null), n.afterCloneFrom(e), t || n.resetOnCopyNodeFrom(e), n;
}
function hl(e) {
	let t = R(), n = e.getType(), r = lc(t, n);
	r === void 0 && T(200, e.constructor.name, n);
	let { replace: i, replaceWithKlass: a } = r;
	if (i !== null) {
		let t = i(e), r = t.constructor;
		return a === null ? t instanceof e.constructor && r !== e.constructor || T(202, r.name, r.getType(), e.constructor.name, n) : t instanceof a || T(201, a.name, a.getType(), r.name, r.getType(), e.constructor.name, n), t.__key === e.__key && T(203, e.constructor.name, n, r.name, r.getType()), t;
	}
	return e;
}
function gl(e, t) {
	!ms(e.getParent()) || z(t) || B(t) || T(99);
}
function _l(e) {
	let t = V(e);
	return t === null && T(63, e), t;
}
function vl(e) {
	if (!e || e.isInline()) return !1;
	if (B(e)) return !0;
	if (z(e)) {
		if (e.isShadowRoot()) {
			let t = e.getParent();
			return !(z(t) && t.isShadowRoot());
		}
		return !e.canBeEmpty();
	}
	return !1;
}
function yl(e, t, n) {
	n.style.removeProperty("caret-color"), t._blockCursorElement = null;
	let r = e.parentElement;
	r !== null && r.removeChild(e);
}
function bl(e) {
	return D ? (e || window).getSelection() : null;
}
function xl(e) {
	let t = cl(e);
	return t ? t.getSelection() : null;
}
function Sl(e) {
	return Rl(e) && "host" in e;
}
var Cl = [];
function wl(e) {
	let t = e.getRootNode();
	if (t === e || !Sl(t)) return Cl;
	let n = [t], r = t.host;
	for (;;) {
		let e = r.getRootNode();
		if (e === r || !Sl(e)) break;
		n.push(e), r = e.host;
	}
	return n;
}
function* Tl(e) {
	let t = [e], n;
	for (; n = t.pop();) {
		yield* n.querySelectorAll("[data-lexical-editor=\"true\"]");
		let e = (yc(n) ? n : n.ownerDocument).createTreeWalker(n, NodeFilter.SHOW_ELEMENT), r;
		for (; r = e.nextNode();) r.shadowRoot && t.push(r.shadowRoot);
	}
}
function El(e) {
	return e === null ? document : e.ownerDocument;
}
function Dl() {
	let e = Wo();
	return El(e === null ? null : e._rootElement);
}
function Ol(e, t) {
	if (t === null || typeof e.getComposedRanges != "function") return null;
	let n = wl(t);
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
function kl(e, t) {
	let n = Ol(e, t);
	if (n !== null) {
		let e = jl(n);
		if (e !== null) return e;
	}
	return e.rangeCount > 0 ? e.getRangeAt(0) : null;
}
function Al(e, t) {
	let n = Ol(e, t);
	return n === null ? e : Ml(n, Nl(e));
}
function jl(e) {
	let t = e.startContainer.ownerDocument;
	if (t === null) return null;
	let n = t.createRange();
	try {
		return n.setStart(e.startContainer, e.startOffset), n.setEnd(e.endContainer, e.endOffset), n;
	} catch {
		return null;
	}
}
function Ml(e, t) {
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
function Nl(e) {
	return e.direction;
}
function Pl(e) {
	let t = e.getRootNode();
	return yc(t) || Sl(t) ? t.activeElement : null;
}
function Fl(e) {
	let t = e.activeElement;
	for (; t !== null && t.shadowRoot !== null;) {
		let e = t.shadowRoot.activeElement;
		if (e === null) break;
		t = e;
	}
	return t;
}
function Il(e) {
	let t = e.target;
	if (t !== null && U(t) && t.shadowRoot !== null && typeof e.composedPath == "function") {
		let t = e.composedPath();
		if (t.length > 0) return t[0];
	}
	return t;
}
function U(e) {
	return Ll(e) && e.nodeType === 1;
}
function Ll(e) {
	return typeof e == "object" && !!e && "nodeType" in e && typeof e.nodeType == "number";
}
function Rl(e) {
	return Ll(e) && e.nodeType === 11;
}
var zl = /^(a|abbr|acronym|b|cite|code|del|em|i|ins|kbd|label|mark|output|q|ruby|s|samp|span|strong|sub|sup|time|u|tt|var|#text)$/i;
function Bl(e) {
	return !(!U(e) || !e.style.display.startsWith("inline")) || zl.test(e.nodeName);
}
var W = /^(address|article|aside|blockquote|canvas|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h1|h2|h3|h4|h5|h6|header|hr|li|main|nav|noscript|ol|p|pre|section|table|td|tfoot|ul|video)$/i;
function G(e) {
	return (!U(e) || !e.style.display.startsWith("inline")) && W.test(e.nodeName);
}
function K(e) {
	if (B(e) && !e.isInline()) return !0;
	if (!z(e) || pl(e)) return !1;
	let t = e.getFirstChild(), n = t === null || ws(t) || N(t) || t.isInline();
	return !e.isInline() && !1 !== e.canBeEmpty() && n;
}
function q() {
	return R();
}
function J(e = q()) {
	return e._config.dom || $s;
}
function Vl(e, t, n = q()) {
	let r = J(n).$getDOMSlot(e, t, n);
	return z(e) && (Hl(r) || T(344, e.getKey(), e.getType())), r;
}
function Hl(e) {
	return e instanceof Ge;
}
function Ul(e, t, n = q()) {
	return bc(Vl(e, t, n).element);
}
var Wl = /* @__PURE__ */ new WeakMap(), Gl = /* @__PURE__ */ new Map();
function Kl(e) {
	if (!e._readOnly && e.isEmpty()) return Gl;
	e._readOnly || T(192);
	let t = Wl.get(e);
	return t || (t = function(e) {
		let t = /* @__PURE__ */ new Map();
		for (let [n, r] of e._nodeMap) {
			let e = r.__type, i = t.get(e);
			i || (i = /* @__PURE__ */ new Map(), t.set(e, i)), i.set(n, r);
		}
		return t;
	}(e), Wl.set(e, t)), t;
}
function ql(e) {
	let t = e.constructor.clone(e, oc);
	return t.afterCloneFrom(e), t;
}
function Jl(e) {
	return (t = ql(e))[M] = !0, t;
	var t;
}
function Yl(e, t) {
	let n = e.getAttribute("data-lexical-indent");
	if (n !== null) {
		let e = parseInt(n, 10);
		if (Number.isFinite(e) && e >= 0) return void t.setIndent(e);
	}
	let r = parseInt(e.style.paddingInlineStart, 10) || 0, i = Math.round(r / 40);
	t.setIndent(i);
}
function Xl(e, t) {
	let n = t.getAttribute("dir");
	return n === "ltr" || n === "rtl" ? e.setDirection(n) : e;
}
function Zl(e, t) {
	let n = t.style.textAlign;
	return n && n in je ? e.setFormat(n) : e;
}
function Ql(e, t) {
	e.__lexicalUnmanaged = !0, t && t.captureSelection !== void 0 && (e.__lexicalCapturedSelection = t.captureSelection);
}
function $l(e) {
	return !0 === e.__lexicalUnmanaged;
}
function eu(e, t = q()) {
	let n = t.isEditable();
	e.contentEditable = n ? "true" : "false", n ? e.__lexicalEditor = t : delete e.__lexicalEditor;
}
function tu(e, t) {
	let n = e;
	for (; n != null;) {
		if (!0 === n.__lexicalCapturedSelection) return !0;
		if (U(n) && n.hasAttribute("data-lexical-slot") || kc(n, t) !== void 0) return !1;
		n = tl(n);
	}
	return !1;
}
function nu(e, t) {
	return kt(e, t) && e[t] !== Wi[t];
}
var ru = /* @__PURE__ */ new WeakMap();
function iu(e) {
	let t = ru.get(e);
	return t === void 0 ? function(e) {
		let t = e.prototype != null && Le in e.prototype ? e.prototype[Le]() : void 0, n = function(e) {
			if (!(e === Wi || e.prototype instanceof Wi)) {
				let t = "<unknown>", n = "<unknown>";
				try {
					t = e.getType();
				} catch {}
				try {
					rc.version && (n = JSON.parse(rc.version));
				} catch {}
				T(290, e.name, t, n);
			}
			return e === fs || e === us || e === Wi;
		}(e), r = !n && nu(e, "getType") ? e.getType : void 0, i = r && !(ou in r) ? r.call(e) : void 0, a, o = i;
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
		ru.set(e, s);
		try {
			let t = function(e) {
				let t = e.prototype, n = /* @__PURE__ */ new Map(), { fieldsBaseFirst: r } = pu(e);
				for (let [i, a] of r) {
					let r = gu(e, i, a);
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
				return n.size === 0 ? su : [...n.values()];
			}(e), r = function(e) {
				let t = e.prototype, n = /* @__PURE__ */ new Map();
				for (let [r, i] of pu(e).fieldsDerivedFirst) {
					let a = hu(e, r, i);
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
				return n.size === 0 ? mu : [...n.values()];
			}(e), i = pu(e), c = function(e, t, n) {
				let r, i = e;
				for (let { klass: t, ownNodeConfig: n } of Du(e)) n && n.generated !== void 0 && (r === void 0 ? (r = n.generated, i = t) : n.generated === r && (i = t));
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
				}(n, au(iu(i))) ? r : null;
			}(e, 0, {
				getters: r,
				setters: t
			});
			s.compiled = {
				flatStates: i.flatStates,
				generated: c === null ? null : c(i.fields),
				getters: r,
				isCompactDefault: yu(r),
				setters: t
			}, function(e, t, n, r) {
				if (!t && n) {
					if (!nu(e, "getType")) {
						let t = e, r = function() {
							return this === t ? n : Wi.getType.call(this);
						};
						r[ou] = !0, e.getType = r;
					}
					if (nu(e, "clone") || (e.clone = (t, n) => {
						ac(t);
						let r = new e();
						return n !== oc && r.afterCloneFrom(t), r;
					}), nu(e, "importJSON") || (e.importJSON = r && r.$importJSON || function(e) {
						return (t) => {
							let n = Ou(e);
							return n.updateFromJSON === Wi.prototype.updateFromJSON ? function(e, t) {
								return xu(e.__state || t.$ !== void 0 ? Jt(e, t) : e, t);
							}(n, t) : n.updateFromJSON(t);
						};
					}(e)), !nu(e, "importDOM") && r) {
						let { importDOM: t } = r;
						t && (e.importDOM = () => t);
					}
				}
			}(e, n, o, a), function(e) {
				for (let { klass: t, ownNodeConfig: n } of Du(e)) {
					let e = t.prototype;
					if (kt(e, "afterCloneFrom")) continue;
					let r = Eu(t);
					if (r.length === 0) continue;
					let i = Object.getPrototypeOf(e), a = n && n.generated !== void 0 ? au(iu(t)).generated : null, o = a !== null && a.afterCloneFrom || ((e, t) => {
						let n = e, i = t;
						for (let e = 0; e < r.length; e++) {
							let t = r[e];
							n[t] = i[t];
						}
					});
					e.afterCloneFrom = function(e) {
						i.afterCloneFrom.call(this, e), o(this, e);
					}, e.afterCloneFrom[wu] = !0;
				}
			}(e);
		} catch (t) {
			throw ru.delete(e), t;
		}
		return s;
	}(e) : t;
}
function au(e) {
	let { compiled: t } = e;
	return t === void 0 && T(422, e.config.klass.name), t;
}
var ou = Symbol("lexical.synthesizedGetType"), su = [];
function cu(e, t, n, r) {
	let i = n.method === void 0 ? r : n.method, a = pu(e).declaredBy.get(t);
	if (a === void 0) return n;
	let o = e.prototype, s = a.prototype;
	return lu(o, s, i) && lu(o, s, r) ? n : i;
}
function lu(e, t, n) {
	return e[n] === t[n];
}
function uu(e) {
	return `set${e.charAt(0).toUpperCase()}${e.slice(1)}`;
}
function du(e) {
	return `get${e.charAt(0).toUpperCase()}${e.slice(1)}`;
}
var fu = {
	declaredBy: /* @__PURE__ */ new Map(),
	fields: /* @__PURE__ */ new Map(),
	fieldsBaseFirst: [],
	fieldsDerivedFirst: [],
	flatStates: []
};
function pu(e) {
	let t = iu(e);
	return t.composed === void 0 && (t.composed = function(e) {
		let t = [], n = [], r = [];
		for (let { klass: i, ownNodeConfig: a } of Du(e)) {
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
		return i.size === 0 && s.size === 0 ? fu : {
			declaredBy: o,
			fields: a,
			fieldsBaseFirst: [...a],
			fieldsDerivedFirst: [...i],
			flatStates: [...s.values()]
		};
	}(e)), t.composed;
}
var mu = [];
function hu(e, t, n) {
	let r = n.getter;
	if (r === null) return null;
	let i = r === void 0 ? du(t) : r;
	return gt(i) ? cu(e, t, i, du(t)) : i;
}
function gu(e, t, n) {
	let r = n.setter;
	if (r === null) return null;
	let i = r === void 0 ? uu(t) : r;
	return gt(i) ? cu(e, t, i, uu(t)) : i;
}
function _u(e) {
	return e;
}
function vu(e, t) {
	let { defaultValue: n, isEqual: r } = e;
	return t === void 0 || t === n || r !== void 0 && r(t, n);
}
function yu(e) {
	let t;
	return (n, r) => {
		t === void 0 && (t = new Map(e.map((e) => [e.key, e])));
		let i = t.get(n);
		return i !== void 0 && vu(i, r);
	};
}
function bu(e) {
	let { setterTable: t, schema: n } = e, { defaultValue: r } = n;
	return t === void 0 ? r : t[String(r)];
}
function xu(e, t) {
	let { flatStates: n, generated: r, setters: i } = au(iu(e.constructor)), a = function(e, t, n) {
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
			i.kind === "ownField" ? _u(e)[i.field] = i.setterTable === void 0 ? a : kt(i.setterTable, a) ? i.setterTable[a] : bu(i) : i.setter.call(e, a);
		}
		return e;
	}(a, t, i);
}
function Su(e) {
	return iu(e).config;
}
function Cu(e) {
	let t = [];
	for (let n of [e.getter, e.setter]) gt(n) && n.field !== "__proto__" && !t.includes(n.field) && t.push(n.field);
	return t;
}
var wu = "__lexicalSynthesizedAfterCloneFrom";
function Tu(e) {
	let { declaredBy: t, fieldsBaseFirst: n } = pu(e), r = [];
	for (let [i, a] of n) if (t.get(i) === e) for (let e of Cu(a)) r.includes(e) || r.push(e);
	return r;
}
function Eu(e) {
	let t = Tu(e);
	if (t.length === 0) return t;
	let n = /* @__PURE__ */ new Set();
	for (let { klass: t } of Du(e)) if (t !== e) for (let e of Tu(t)) n.add(e);
	return n.size === 0 ? t : t.filter((e) => !n.has(e));
}
function* Du(e) {
	for (let t = e; t && (t === Wi || Gi(t.prototype));) {
		let e = Su(t), n = e.declaresOwnConfig;
		yield n ? e : {
			...e,
			ownNodeConfig: void 0
		}, t = n && e.ownNodeConfig && e.ownNodeConfig.extends || ju(t);
	}
}
function Ou(e) {
	let t = q();
	Ro();
	let n = t.resolveRegisteredNodeAfterReplacements(t.getRegisteredNode(e)), r = new n.klass();
	return n.replace === null ? r : hl(r);
}
var ku = (e, t) => {
	let n = e;
	for (; n != null && !ms(n);) {
		if (t(n)) return n;
		n = n.getParent();
	}
	return null;
};
function Au(e, t) {
	let n = [], r = e.__first;
	for (; r !== null;) {
		let e = t === null ? V(r) : t.get(r);
		e ?? T(174), n.push(r), r = e.__next;
	}
	return n;
}
function ju(e) {
	let t = Object.getPrototypeOf(e);
	if (typeof t == "function" && t !== Function.prototype) return t;
	let n = e.prototype && Object.getPrototypeOf(e.prototype);
	return n ? n.constructor : null;
}
var Mu = /* @__PURE__ */ new Map();
function Nu(e) {
	return z(e) || B(e);
}
function Pu(e) {
	return z(e) || B(e);
}
function Fu(e) {
	let t = e.getLatest();
	return Pu(t) ? t.__slotHost : null;
}
function Iu(e) {
	let t = Fu(e);
	if (t === null) return null;
	let n = V(t);
	return z(n) || B(n) || T(370), n;
}
function Lu(e) {
	let t = Iu(e);
	if (t === null) return null;
	let n = e.getLatest().__key;
	for (let [e, r] of Bu(t)) if (r === n) return e;
	return null;
}
function Ru(e) {
	let t = e.getLatest();
	for (; t !== null;) {
		if (Fu(t) !== null) return t;
		t = t.getParent();
	}
	return null;
}
function zu(e) {
	if (e === null) return null;
	let t = P(e) ? e.anchor.getNode() : e.getNodes()[0] ?? null;
	return t === null ? null : Ru(t);
}
function Bu(e) {
	let t = e.getLatest();
	return Nu(t) && t.__slots !== null ? t.__slots : Mu;
}
function Vu(e) {
	return Array.from(Bu(e).keys());
}
function Hu(e, t) {
	let n = Bu(e).get(t);
	return n === void 0 ? null : V(n);
}
var Uu = [
	"__proto__",
	"constructor",
	"prototype"
], Wu = Symbol("slotMapOwner");
function Gu(e) {
	let t = e.__slots;
	return t !== null && t[Wu] === e || (t = new Map(t), t[Wu] = e, e.__slots = t), t;
}
var Ku = /* @__PURE__ */ new WeakMap(), Y = [];
function qu(e) {
	for (let { ownNodeConfig: t } of Du(e)) {
		let e = t && t.slots;
		if (e) return e;
	}
	return Y;
}
function Ju(e) {
	let t = "";
	for (let n of Vu(e)) {
		let r = Hu(e, n);
		r !== null && (t += r.getTextContent());
	}
	return t;
}
function Yu(e, t, n) {
	let r = n.get(e), i = n.get(t);
	return r === void 0 ? i === void 0 ? e < t ? -1 : +(e > t) : 1 : i === void 0 ? -1 : r - i;
}
function Xu(e, t, n) {
	t !== "__proto__" && t !== "constructor" && t !== "prototype" || T(373, t);
	let r = e.getLatest();
	if (r.__slots !== null && r.__slots.get(t) === n.getLatest().__key) return r;
	(!z(n) && !B(n) || n.isInline()) && T(374, n.__key);
	let i = e.getWritable(), a = Gu(i), o = a.get(t);
	o !== void 0 && Zu(o);
	let s = n.getWritable(), c = Iu(s);
	if (c !== null) {
		let e = Lu(s);
		e !== null && Gu(c.getWritable()).delete(e), s.__slotHost = null;
	}
	return Cc(s), s.__slotHost = i.__key, a.set(t, s.__key), function(e) {
		let t = e.__slots;
		if (t === null || t.size < 2) return;
		let n = function(e) {
			let t = Ku.get(e);
			if (t === void 0) {
				let n = qu(e), r = /* @__PURE__ */ new Map();
				for (let t of n) Uu.includes(t) && T(371, e.name, t), r.has(t) && T(372, e.name, t), r.set(t, r.size);
				t = r, Ku.set(e, t);
			}
			return t;
		}(e.constructor), r = null, i = !0;
		for (let e of t.keys()) {
			if (r !== null && Yu(r, e, n) > 0) {
				i = !1;
				break;
			}
			r = e;
		}
		if (i) return;
		let a = Array.from(t).sort(([e], [t]) => Yu(e, t, n));
		t.clear();
		for (let [e, n] of a) t.set(e, n);
	}(i), R()._slotsUsed = !0, Bo()._slotsUsed = !0, i;
}
function Zu(e) {
	let t = V(e);
	if (t === null) return;
	let n = t.getWritable();
	Pu(n) || T(377, e), n.__slotHost = null, n.remove();
}
var Qu = {
	next: "previous",
	previous: "next"
}, $u = class {
	origin;
	constructor(e) {
		this.origin = e;
	}
	[Symbol.iterator]() {
		return wd({
			hasNext: sd,
			initial: this.getAdjacentCaret(),
			map: (e) => e,
			step: (e) => e.getAdjacentCaret()
		});
	}
	getAdjacentCaret() {
		return fd(this.getNodeAtCaret(), this.direction);
	}
	getSiblingCaret() {
		return fd(this.origin, this.direction);
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
			i = fd(e, this.direction);
		}
		for (let e of o.values()) e.remove();
		return this;
	}
}, ed = class e extends $u {
	type = "child";
	getLatest() {
		let e = this.origin.getLatest();
		return e === this.origin ? this : gd(e, this.direction);
	}
	getParentCaret(e = "root") {
		return fd(rd(this.getParentAtCaret(), e), this.direction);
	}
	getFlipped() {
		let e = nd(this.direction);
		return fd(this.getNodeAtCaret(), e) || gd(this.origin, e);
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
}, td = {
	root: ms,
	shadowRoot: pl
};
function nd(e) {
	return Qu[e];
}
function rd(e, t = "root") {
	return e === null || td[t](e) ? null : Fu(e) === null ? e : null;
}
var id = class e extends $u {
	type = "sibling";
	getLatest() {
		let e = this.origin.getLatest();
		return e === this.origin ? this : fd(e, this.direction);
	}
	getSiblingCaret() {
		return this;
	}
	getParentAtCaret() {
		return this.origin.getParent();
	}
	getChildCaret() {
		return z(this.origin) ? gd(this.origin, this.direction) : null;
	}
	getParentCaret(e = "root") {
		return fd(rd(this.getParentAtCaret(), e), this.direction);
	}
	getFlipped() {
		let e = nd(this.direction);
		return fd(this.getNodeAtCaret(), e) || gd(this.origin.getParentOrThrow(), e);
	}
	isSamePointCaret(t) {
		return t instanceof e && this.direction === t.direction && this.origin.is(t.origin);
	}
	isSameNodeCaret(t) {
		return (t instanceof e || t instanceof ad) && this.direction === t.direction && this.origin.is(t.origin);
	}
}, ad = class e extends $u {
	type = "text";
	offset;
	constructor(e, t) {
		super(e), this.offset = t;
	}
	getLatest() {
		let e = this.origin.getLatest();
		return e === this.origin ? this : pd(e, this.direction, this.offset);
	}
	getParentAtCaret() {
		return this.origin.getParent();
	}
	getChildCaret() {
		return null;
	}
	getParentCaret(e = "root") {
		return fd(rd(this.getParentAtCaret(), e), this.direction);
	}
	getFlipped() {
		return pd(this.origin, nd(this.direction), this.offset);
	}
	isSamePointCaret(t) {
		return t instanceof e && this.direction === t.direction && this.origin.is(t.origin) && this.offset === t.offset;
	}
	isSameNodeCaret(t) {
		return (t instanceof id || t instanceof e) && this.direction === t.direction && this.origin.is(t.origin);
	}
	getSiblingCaret() {
		return fd(this.origin, this.direction);
	}
};
function od(e) {
	return e instanceof ad;
}
function sd(e) {
	return e instanceof id;
}
function cd(e) {
	return e instanceof ed;
}
var ld = {
	next: class extends ad {
		direction = "next";
		getNodeAtCaret() {
			return this.origin.getNextSibling();
		}
		insert(e) {
			return this.origin.insertAfter(e), this;
		}
	},
	previous: class extends ad {
		direction = "previous";
		getNodeAtCaret() {
			return this.origin.getPreviousSibling();
		}
		insert(e) {
			return this.origin.insertBefore(e), this;
		}
	}
}, ud = {
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
}, dd = {
	next: class extends ed {
		direction = "next";
		getNodeAtCaret() {
			return this.origin.getFirstChild();
		}
		insert(e) {
			return this.origin.splice(0, 0, [e]), this;
		}
	},
	previous: class extends ed {
		direction = "previous";
		getNodeAtCaret() {
			return this.origin.getLastChild();
		}
		insert(e) {
			return this.origin.splice(this.origin.getChildrenSize(), 0, [e]), this;
		}
	}
};
function fd(e, t) {
	return e ? new ud[t](e) : null;
}
function pd(e, t, n) {
	return e ? new ld[t](e, md(e, n)) : null;
}
function md(e, t, n = "error") {
	let r = e.getTextContentSize(), i = t === "next" ? r : t === "previous" ? 0 : t;
	return (i < 0 || i > r) && (n !== "clamp" && le(284, String(t), String(r), e.getKey()), i = i < 0 ? 0 : r), i;
}
function hd(e, t) {
	return new bd(e, t);
}
function gd(e, t) {
	return z(e) ? new dd[t](e) : null;
}
function _d(e) {
	return e && e.getChildCaret() || e;
}
function vd(e) {
	return e && _d(e.getAdjacentCaret());
}
var yd = class e {
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
			return od(t) ? function(e, t) {
				let { direction: n, origin: r } = e;
				return hd(e, md(r, t === "focus" ? nd(n) : n) - e.offset);
			}(t, e) : null;
		}, t = e("anchor"), n = e("focus");
		if (t && n) {
			let { caret: e } = t, { caret: r } = n;
			if (e.isSameNodeCaret(r)) return [hd(e, r.offset - e.offset), null];
		}
		return [t, n];
	}
	iterNodeCarets(e = "root") {
		let t = od(this.anchor) ? this.anchor.getSiblingCaret() : this.anchor.getLatest(), n = this.focus.getLatest(), r = od(n), i = (t) => t.isSameNodeCaret(n) ? null : vd(t) || t.getParentCaret(e);
		return wd({
			hasNext: (e) => e !== null && !(r && n.isSameNodeCaret(e)),
			initial: t.isSameNodeCaret(n) ? null : i(t),
			map: (e) => e,
			step: i
		});
	}
	[Symbol.iterator]() {
		return this.iterNodeCarets("root");
	}
}, bd = class {
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
		return pd(e.setTextContent(i.slice(0, n) + i.slice(r)), t, n);
	}
};
function xd(e, t) {
	return e.direction === t ? e : e.getFlipped();
}
function X(e) {
	return Cd(e, xd(gd(Nc(), nd(e.direction)), e.direction));
}
function Sd(e) {
	return Cd(e, e);
}
function Cd(e, t) {
	return e.direction !== t.direction && T(265), new yd(e, t, e.direction);
}
function wd(e) {
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
function Td(e, t) {
	let n = kd(e.origin, t.origin);
	switch (n === null && T(275, e.origin.getKey(), t.origin.getKey()), n.type) {
		case "same": {
			let n = e.type === "text", r = t.type === "text";
			return n && r ? function(e, t) {
				return Math.sign(e - t);
			}(e.offset, t.offset) : e.type === t.type ? 0 : n ? -1 : r ? 1 : e.type === "child" ? -1 : 1;
		}
		case "ancestor": return e.type === "child" ? -1 : 1;
		case "descendant": return t.type === "child" ? 1 : -1;
		case "branch": return Ed(n);
	}
}
function Ed(e) {
	let { a: t, b: n } = e, r = t.__key, i = n.__key, a = t, o = n;
	for (; a && o; a = a.getNextSibling(), o = o.getNextSibling()) {
		if (a.__key === i) return -1;
		if (o.__key === r) return 1;
	}
	return a === null ? 1 : -1;
}
function Dd(e, t) {
	return t.is(e);
}
function Od(e) {
	return z(e) ? [e.getLatest(), null] : [e.getParent(), e.getLatest()];
}
function kd(e, t) {
	if (e.is(t)) return {
		commonAncestor: e,
		type: "same"
	};
	let n = /* @__PURE__ */ new Map();
	for (let [t, r] = Od(e); t; r = t, t = t.getParent()) n.set(t, r);
	for (let [r, i] = Od(t); r; i = r, r = r.getParent()) {
		let a = n.get(r);
		if (a !== void 0) return a === null ? (Dd(e, r) || T(276), {
			commonAncestor: r,
			type: "ancestor"
		}) : i === null ? (Dd(t, r) || T(277), {
			commonAncestor: r,
			type: "descendant"
		}) : ((z(a) || Dd(e, a)) && (z(i) || Dd(t, i)) && r.is(a.getParent()) && r.is(i.getParent()) || T(278), {
			a,
			b: i,
			commonAncestor: r,
			type: "branch"
		});
	}
	return null;
}
function Ad(e) {
	return e;
}
function jd(...e) {
	return e;
}
function Md(e, t) {
	if (!t || e === t) return e;
	for (let n in t) if (e[n] !== t[n]) return {
		...e,
		...t
	};
	return e;
}
function Nd(...e) {
	let t = [];
	for (let n of e) if (n && typeof n == "string") for (let [e] of n.matchAll(/\S+/g)) t.push(e);
	return t;
}
function Pd(...e) {
	return () => {
		for (let t = e.length - 1; t >= 0; t--) e[t]();
		e.length = 0;
	};
}
function Z(e, t, n) {
	return Pd(...Object.entries(t).map(([t, r]) => ti(e, t, r, n)));
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/react@19.2.8/node_modules/react/cjs/react-jsx-runtime.production.js
var Fd = /* @__PURE__ */ e(((e) => {
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
})), Q = (/* @__PURE__ */ e(((e, t) => {
	t.exports = Fd();
})))(), Id = Object.freeze({
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
}), Ld = /* @__PURE__ */ new WeakMap();
function Rd(e, t) {
	return Ld.get(e)?.(), Ld.set(e, t), () => {
		Ld.get(e) === t && Ld.delete(e);
	};
}
function zd(e, t, n, r, i, a) {
	let o = Math.max(0, r.width - i * 2), s = Math.min(t, o), c = r.left + i, l = Math.max(r.top, e.bottom), u = Math.max(0, r.top + r.height - i - l), d = a === "above" ? i : 0, f = Math.max(0, e.top - r.top - i - d), p = a === "above" || n > u && f > u, m = p ? f : u, h = p ? e.top - d - Math.min(n, m) : l, g = a === "above" ? Math.max(r.top + i, h) : h;
	return {
		left: Math.max(c, Math.min((e.left + e.right - s) / 2, r.left + r.width - i - s)),
		top: g,
		maxWidth: o,
		maxHeight: m
	};
}
function Bd(e, t, n) {
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
		let u = t.getBoundingClientRect(), d = zd(o, u.width, Math.max(u.height, t.scrollHeight), l, s, n), f = a ? t.offsetParent?.getBoundingClientRect() ?? c : void 0;
		t.style.left = `${d.left - (f?.left ?? 0)}px`, t.style.top = `${d.top - (f?.top ?? 0)}px`, t.style.maxHeight = `${d.maxHeight}px`;
	};
	o();
	let s = new ResizeObserver(o);
	return s.observe(e), s.observe(t), a && s.observe(a), r.addEventListener("resize", o), r.addEventListener("scroll", o, !0), i?.addEventListener("resize", o), i?.addEventListener("scroll", o), () => {
		s.disconnect(), r.removeEventListener("resize", o), r.removeEventListener("scroll", o, !0), i?.removeEventListener("resize", o), i?.removeEventListener("scroll", o);
	};
}
var Vd = /* @__PURE__ */ new WeakSet();
function Hd(e) {
	Vd.add(e);
	let t = () => {
		Vd.delete(e), e.removeEventListener("keydown", n, !0);
	}, n = (e) => {
		e.key !== "Escape" && t();
	};
	e.addEventListener("keydown", n, !0), e.defaultView?.requestAnimationFrame(t);
}
function Ud(e, t, n, r) {
	let i = t.ownerDocument, a = i.defaultView, o = e.closest("[data-tmt-ds-scope]");
	o && (n.removeAttribute("popover"), n.hidden = !0);
	let s = () => o ? !n.hidden : n.matches(":popover-open"), c = !1, l = !1, u = !1, d = !1, f = t.getAttribute("aria-expanded") === "true", p = !1, m, h, g, _ = () => {
		g?.(), g = void 0, h?.(), h = void 0, i.removeEventListener("keydown", y, !0), o ? (n.hidden = !0, n.removeAttribute("data-tmt-ds-open")) : n.matches(":popover-open") && n.hidePopover();
	}, v = () => {
		u = !0, _();
	}, y = (e) => {
		e.key !== "Escape" || !s() || o && !o.contains(e.target) || (v(), Hd(i));
	}, b = () => {
		if (!(!d && (c || l) && !u && !f && t.isConnected && t.getClientRects().length > 0)) {
			_();
			return;
		}
		if (s()) return;
		let e = r ? r.anchor() : t;
		e?.isConnected && (h = Rd(o ?? i, v), o ? (n.hidden = !1, n.setAttribute("data-tmt-ds-open", "")) : n.showPopover(), g = Bd(e, n, r?.side), i.addEventListener("keydown", y, !0));
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
		t.matches(":focus-visible") && (l = !0, f = t.getAttribute("aria-expanded") === "true", u = f || p || Vd.has(i), b());
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
//#region ../../../../design/browser-ui/src/ui/scope.tsx
var Wd = o();
(0, y.createContext)(void 0), (0, y.createContext)(void 0), (0, y.createContext)(null), (0, y.createContext)(null), (0, y.createContext)(null), (0, y.createContext)(null);
//#endregion
//#region ../../../../design/browser-ui/src/field.tsx
function Gd({ controlId: e, label: t, description: n, descriptionId: r, error: i, errorId: a, describedByIds: o = [], invalid: s, renderControl: c }) {
	let l = n != null, u = i != null, d = `${e}-label`, f = [l ? r : void 0, u ? a : void 0];
	if (!e.trim() || /\s/.test(e) || l && !r || u && !a) throw Error("Field content requires explicit nonempty IDs");
	let p = [
		e,
		d,
		...f.filter((e) => e !== void 0)
	];
	if (p.some((e) => !e.trim() || /\s/.test(e)) || new Set(p).size !== p.length) throw Error("Field IDs must be distinct single IDs");
	let m = [.../* @__PURE__ */ new Set([...o.flatMap((e) => e.split(/\s+/).filter(Boolean)), ...p.slice(2)])].join(" ") || void 0;
	return /* @__PURE__ */ (0, Q.jsxs)("div", {
		className: Id.field,
		children: [
			/* @__PURE__ */ (0, Q.jsx)("label", {
				className: Id.fieldLabel,
				id: d,
				htmlFor: e,
				children: t
			}),
			c({
				id: e,
				className: Id.fieldControl,
				"aria-labelledby": d,
				"aria-describedby": m,
				"aria-invalid": s
			}),
			l && /* @__PURE__ */ (0, Q.jsx)("div", {
				className: Id.fieldDescription,
				id: r,
				children: n
			}),
			u && /* @__PURE__ */ (0, Q.jsx)("div", {
				className: Id.fieldError,
				id: a,
				children: i
			})
		]
	});
}
function Kd(e) {
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
function qd(e) {
	let [t, n] = (0, y.useState)(!1), [r] = (0, y.useState)(() => Kd(n));
	return (0, y.useEffect)(() => {
		r.set(e);
	}, [r, e]), (0, y.useEffect)(() => () => r.dispose(), [r]), t;
}
//#endregion
//#region ../../../../design/browser-ui/src/icon-action.tsx
function Jd({ type: e, label: t, tooltipLabel: n, tooltipPlacement: r, ariaKeyShortcuts: i, variant: a, icon: o, pressed: s, expanded: c, controls: l, disabled: u = !1, disabledReason: d, disabledReasonId: f, busy: p = !1, busyMark: m, onActivate: h, buttonRef: g, hasPopup: _, onKeyDown: v }) {
	let b = (0, y.useRef)(null), x = (0, y.useRef)(null), S = (0, y.useRef)(null), C = (0, y.useRef)(null), w = qd(p && !u);
	if ((0, y.useImperativeHandle)(g, () => b.current, []), (0, y.useLayoutEffect)(() => (C.current = Ud(S.current, b.current, x.current, r), () => {
		C.current?.dispose(), C.current = null;
	}), [r]), (0, y.useLayoutEffect)(() => {
		C.current?.refresh();
	}, [c]), !t.trim()) throw Error("Icon action requires a nonempty label");
	if (d !== void 0 && !f) throw Error("Disabled reason requires a stable ID");
	return /* @__PURE__ */ (0, Q.jsxs)(Q.Fragment, { children: [/* @__PURE__ */ (0, Q.jsxs)("span", {
		className: Id.iconAction,
		ref: S,
		children: [/* @__PURE__ */ (0, Q.jsxs)("button", {
			ref: b,
			className: `${Id.action} ${Id.iconActionControl}`,
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
			children: [/* @__PURE__ */ (0, Q.jsx)("span", {
				className: Id.iconActionIcon,
				"aria-hidden": "true",
				children: o
			}), m !== void 0 && /* @__PURE__ */ (0, Q.jsx)("span", {
				className: Id.actionMark,
				"aria-hidden": "true",
				"data-busy": w,
				children: m
			})]
		}), /* @__PURE__ */ (0, Q.jsx)("span", {
			ref: x,
			className: Id.iconActionTooltip,
			popover: "manual",
			"aria-hidden": "true",
			children: /* @__PURE__ */ (0, Q.jsx)("span", {
				className: Id.iconActionTooltipLabel,
				children: n ?? t
			})
		})]
	}), d !== void 0 && /* @__PURE__ */ (0, Q.jsx)("span", {
		className: Id.fieldDescription,
		id: f,
		children: d
	})] });
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+text@0.52.0_typescript@5.9.3/node_modules/@lexical/text/dist/LexicalText.prod.js
function Yd() {
	return Nc().getTextContent();
}
function Xd(e, t = !0) {
	if (e) return !1;
	let n = Yd();
	return t && (n = n.trim()), n === "";
}
function Zd(e) {
	if (!Xd(e, !1)) return !1;
	let t = Nc().getChildren(), n = t.length;
	if (n > 1) return !1;
	for (let e = 0; e < n; e++) {
		let n = t[e];
		if (B(n)) return !1;
		if (z(n)) {
			if (!Ys(n) || n.__indent !== 0) return !1;
			let e = n.getChildren(), t = e.length;
			for (let n = 0; n < t; n++) {
				let t = e[n];
				if (!N(t)) return !1;
			}
		}
	}
	return !0;
}
function Qd(e) {
	return () => Zd(e);
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+react@0.52.0_react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@5.9.3_yjs@13.6.32/node_modules/@lexical/react/dist/LexicalContentEditable.prod.js
var $d = D ? y.useLayoutEffect : y.useEffect;
function ef({ editor: e, ariaActiveDescendant: t, ariaAutoComplete: n, ariaControls: r, ariaDescribedBy: i, ariaErrorMessage: a, ariaExpanded: o, ariaInvalid: s, ariaLabel: c, ariaLabelledBy: l, ariaMultiline: u, ariaOwns: d, ariaRequired: f, autoCapitalize: p, className: m, id: h, role: g = "textbox", spellCheck: _ = !0, style: v, tabIndex: b, "data-testid": x, ...S }, C) {
	let [w, ee] = (0, y.useState)(e.isEditable()), te = (0, y.useCallback)((t) => {
		t && t.ownerDocument && t.ownerDocument.defaultView ? e.setRootElement(t) : e.setRootElement(null);
	}, [e]), ne = (0, y.useMemo)(() => function(...e) {
		return (t) => {
			for (let n of e) typeof n == "function" ? n(t) : n != null && (n.current = t);
		};
	}(C, te), [te, C]);
	return $d(() => (ee(e.isEditable()), e.registerEditableListener((e) => {
		ee(e);
	})), [e]), /*#__PURE__*/ (0, Q.jsx)("div", {
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
var tf = /* @__PURE__ */ (0, y.forwardRef)(ef);
function nf(e) {
	return e.read("latest", Qd(e.isComposing()));
}
var rf = /* @__PURE__ */ (0, y.forwardRef)(af);
function af(e, t) {
	let { placeholder: n, ...r } = e, [i] = se();
	return (0, Q.jsxs)(Q.Fragment, { children: [/*#__PURE__*/ (0, Q.jsx)(tf, {
		editor: i,
		...r,
		ref: t
	}), n != null && /*#__PURE__*/ (0, Q.jsx)(of, {
		editor: i,
		content: n
	})] });
}
function of({ content: e, editor: t }) {
	let n = function(e) {
		let [t, n] = (0, y.useState)(() => nf(e));
		return $d(() => {
			function t() {
				let t = nf(e);
				n(t);
			}
			return t(), Pd(e.registerUpdateListener(() => {
				t();
			}), e.registerEditableListener(() => {
				t();
			}));
		}, [e]), t;
	}(t), [r, i] = (0, y.useState)(t.isEditable());
	if ($d(() => (i(t.isEditable()), t.registerEditableListener((e) => {
		i(e);
	})), [t]), !n) return null;
	let a = null;
	return typeof e == "function" ? a = e(r) : e !== null && (a = e), a === null ? null : /*#__PURE__*/ (0, Q.jsx)("div", {
		"aria-hidden": !0,
		children: a
	});
}
//#endregion
//#region ../../../../design/browser-ui/src/rich-input/chip-node.tsx
var sf = (0, y.createContext)((e, t) => `Remove ${t}`), cf = (0, y.createContext)(void 0), lf = class e extends fs {
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
		return (0, y.createElement)(uf, {
			nodeKey: this.getKey(),
			kind: this.__kind,
			text: this.__text,
			data: this.__data
		});
	}
};
function uf({ nodeKey: e, kind: t, text: n, data: r }) {
	let [i] = se(), a = (0, y.useContext)(sf), o = (0, y.useContext)(cf), s = () => {
		i.isEditable() && (i.update(() => {
			let t = V(e);
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
	}) : /* @__PURE__ */ (0, Q.jsxs)("span", {
		className: "tmt-rich-input-chip",
		"data-kind": t,
		contentEditable: !1,
		children: [/* @__PURE__ */ (0, Q.jsx)("span", {
			className: "tmt-rich-input-chip-text",
			children: n
		}), /* @__PURE__ */ (0, Q.jsx)("button", {
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
			children: /* @__PURE__ */ (0, Q.jsx)(ie, { "aria-hidden": "true" })
		})]
	});
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+extension@0.52.0_typescript@5.9.3/node_modules/@lexical/extension/dist/LexicalExtensionConfig.prod.js
function df(e) {
	return (typeof e.nodes == "function" ? e.nodes() : e.nodes) || [];
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+extension@0.52.0_typescript@5.9.3/node_modules/@lexical/extension/dist/LexicalExtensionInitialStateExtension.prod.js
var ff = { tag: qi };
function pf() {
	let e = Nc();
	e.isEmpty() && e.append(Js());
}
var mf = {
	config: {
		setOptions: ff,
		updateOptions: ff
	},
	init: ({ $initialEditorState: e = pf }) => ({
		$initialEditorState: e,
		initialized: !1
	}),
	afterRegistration(e, { updateOptions: t, setOptions: n }, r) {
		let i = r.getInitResult();
		if (!i.initialized) {
			i.initialized = !0;
			let { $initialEditorState: r } = i;
			if (vs(r)) e.setEditorState(r, n);
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
		ps,
		va,
		xs,
		Aa,
		Ks
	]
};
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+extension@0.52.0_typescript@5.9.3/node_modules/@lexical/extension/dist/LexicalExtensionLexicalBuilder.prod.js
function $(e, ...t) {
	throw function(e, ...t) {
		let n = new URL("https://lexical.dev/docs/error"), r = new URLSearchParams();
		r.append("code", e);
		for (let e of t) r.append("v", e);
		return n.search = r.toString(), /* @__PURE__ */ Error(`Minified Lexical error #${e}; visit ${n.toString()} for the full message or use the non-minified dev environment for full errors and additional helpful warnings.`);
	}(e, ...t);
}
function hf() {
	let e;
	try {
		e = "0.52.0+prod.esm";
	} catch {}
	return e ?? "\"<unknown>+source\"";
}
var gf = /* @__PURE__ */ hf(), _f = /* @__PURE__ */ new Set([
	"__proto__",
	"constructor",
	"prototype"
]);
function vf(e, t) {
	if (e && t && !Array.isArray(t) && typeof e == "object" && typeof t == "object") {
		let n = e, r = t;
		for (let e in r) !_f.has(e) && Object.prototype.hasOwnProperty.call(r, e) && (n[e] = vf(n[e], r[e]));
		return e;
	}
	return t;
}
function yf(e) {
	return e.id === 0;
}
function bf(e) {
	return e.id === 2;
}
var xf = /* @__PURE__ */ new Set(), Sf = class {
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
		let e = this.extension.config || {}, t = this.extension.mergeConfig ? this.extension.mergeConfig.bind(this.extension) : Md;
		for (let n of this.configs) e = t(e, n);
		return e;
	}
	init(e) {
		let t = this.state;
		bf(t) || $(306, String(t.id));
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
		t.id !== 4 && $(307, String(t.id), "5"), this.extension.build && (n = this.extension.build(e, t.config, t.registerState));
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
		n.id !== 5 && $(308, String(n.id), "5");
		let r = this.extension.register && this.extension.register(e, n.config, n.registerState);
		return this.state = function(e) {
			return Object.assign(e, { id: 6 });
		}(n), () => {
			let e = this.state;
			e.id !== 7 && $(309, String(n.id), "7"), this.state = function(e) {
				return Object.assign(e, { id: 5 });
			}(e), r && r();
		};
	}
	afterRegistration(e) {
		let t = this.state, n;
		return t.id !== 6 && $(310, String(t.id), "6"), this.extension.afterRegistration && (n = this.extension.afterRegistration(e, t.config, t.registerState)), this.state = function(e) {
			return Object.assign(e, { id: 7 });
		}(t), n;
	}
	getSignal() {
		return this._signal === void 0 && $(311), this._signal;
	}
	getInitResult() {
		this.extension.init === void 0 && $(312, this.extension.name);
		let e = this.state;
		return function(e) {
			return e.id >= 4;
		}(e) || $(313, String(e.id), "4"), e.initResult;
	}
	getInitPeer(e) {
		let t = this.builder.extensionNameMap.get(e);
		return t ? t.getExtensionInitDependency() : void 0;
	}
	getExtensionInitDependency() {
		let e = this.state;
		return function(e) {
			return e.id >= 3;
		}(e) || $(314, String(e.id), "3"), { config: e.config };
	}
	getPeer(e) {
		let t = this.builder.extensionNameMap.get(e);
		return t ? t.getExtensionDependency() : void 0;
	}
	getInitDependency(e) {
		let t = this.builder.getExtensionRep(e);
		return t === void 0 && $(315, this.extension.name, e.name), t.getExtensionInitDependency();
	}
	getDependency(e) {
		let t = this.builder.getExtensionRep(e);
		return t === void 0 && $(315, this.extension.name, e.name), t.getExtensionDependency();
	}
	getState() {
		let e = this.state;
		return function(e) {
			return e.id >= 7;
		}(e) || $(316, String(e.id), "7"), e;
	}
	getDirectDependentNames() {
		return this.builder.incomingEdges.get(this.extension.name) || xf;
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
			})(e) || $(317, this.extension.name), this._dependency = {
				config: e.config,
				init: e.initResult,
				output: e.output
			};
		}
		return this._dependency;
	}
}, Cf = Symbol.for("@lexical/extension/LexicalBuilder");
function wf() {}
function Tf(e) {
	throw e;
}
function Ef(e) {
	return Array.isArray(e) ? e : [e];
}
var Df = gf, Of = class e {
	roots;
	extensionNameMap;
	outgoingConfigEdges;
	incomingEdges;
	conflicts;
	_sortedExtensionReps;
	PACKAGE_VERSION;
	constructor(e) {
		this.outgoingConfigEdges = /* @__PURE__ */ new Map(), this.incomingEdges = /* @__PURE__ */ new Map(), this.extensionNameMap = /* @__PURE__ */ new Map(), this.conflicts = /* @__PURE__ */ new Map(), this.PACKAGE_VERSION = Df, this.roots = e;
		for (let t of e) this.addExtension(t);
	}
	static fromExtensions(t) {
		let n = [Ef(mf)];
		for (let e of t) n.push(Ef(e));
		return new e(n);
	}
	static maybeFromEditor(t) {
		let n = t[Cf];
		return n && (n.PACKAGE_VERSION !== Df && $(292, n.PACKAGE_VERSION, Df), n instanceof e || $(293)), n;
	}
	static fromEditor(t) {
		let n = e.maybeFromEditor(t);
		return n === void 0 && $(294), n;
	}
	constructEditor() {
		let { $initialEditorState: e, onError: t, onWarn: n, ...r } = this.buildCreateEditorArgs(), i = Object.assign(ec({
			...r,
			...t ? { onError: (e) => {
				t(e, i);
			} } : {},
			...n ? { onWarn: (e) => {
				n(e, i);
			} } : {}
		}), { [Cf]: this });
		for (let e of this.sortedExtensionReps()) e.build(i);
		return i;
	}
	buildEditor() {
		let e = wf;
		function t() {
			try {
				e();
			} finally {
				e = wf;
			}
		}
		let n = Object.assign(this.constructEditor(), {
			dispose: t,
			[Symbol.dispose]: t
		});
		return e = Pd(this.registerEditor(n), () => n.setRootElement(null)), n;
	}
	hasExtensionByName(e) {
		return this.extensionNameMap.has(e);
	}
	getExtensionRep(e) {
		let t = this.extensionNameMap.get(e.name);
		if (t) return t.extension !== e && $(295, e.name), t;
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
		this._sortedExtensionReps !== void 0 && $(296);
		let [t] = Ef(e);
		typeof t.name != "string" && $(297, typeof t.name);
		let n = this.extensionNameMap.get(t.name);
		if (n !== void 0 && n.extension !== t && $(298, t.name), !n) {
			n = new Sf(this, t), this.extensionNameMap.set(t.name, n);
			let e = this.conflicts.get(t.name);
			typeof e == "string" && $(299, t.name, e);
			for (let e of t.conflictsWith || []) this.extensionNameMap.has(e) && $(299, t.name, e), this.conflicts.set(e, t.name);
			for (let e of t.dependencies || []) {
				let n = Ef(e);
				this.addEdge(t.name, n[0].name, n.slice(1)), this.addExtension(n);
			}
			for (let [e, n] of t.peerDependencies || []) this.addEdge(t.name, e, n ? [n] : []);
		}
	}
	sortedExtensionReps() {
		if (this._sortedExtensionReps) return this._sortedExtensionReps;
		let e = [], t = (n, r) => {
			let i = n.state;
			if (bf(i)) return;
			let a = n.extension.name;
			var o;
			yf(i) || $(300, a, r || "[unknown]"), yf(o = i) || $(304, String(o.id), "0"), i = Object.assign(o, { id: 1 }), n.state = i;
			let s = this.outgoingConfigEdges.get(a);
			if (s) for (let e of s.keys()) {
				let n = this.extensionNameMap.get(e);
				n && t(n, a);
			}
			i = function(e) {
				return function(e) {
					return e.id === 1;
				}(e) || $(305, String(e.id), "1"), Object.assign(e, { id: 2 });
			}(i), n.state = i, e.push(n);
		};
		for (let e of this.extensionNameMap.values()) yf(e.state) && t(e);
		for (let t of e) for (let [e, n] of this.outgoingConfigEdges.get(t.extension.name) || []) if (n.length > 0) {
			let t = this.extensionNameMap.get(e);
			if (t) for (let e of n) t.configs.add(e);
		}
		for (let [e, ...t] of this.roots) if (t.length > 0) {
			let n = this.extensionNameMap.get(e.name);
			n === void 0 && $(301, e.name);
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
		return Pd(...r);
	}
	buildCreateEditorArgs() {
		let e = {}, t = /* @__PURE__ */ new Set(), n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map(), i = {}, a = {}, o = this.sortedExtensionReps();
		for (let s of o) {
			let { extension: o } = s;
			if (o.onError !== void 0 && (e.onError = o.onError), o.onWarn !== void 0 && (e.onWarn = o.onWarn), o.disableEvents !== void 0 && (e.disableEvents = o.disableEvents), o.parentEditor !== void 0 && (e.parentEditor = o.parentEditor), o.editable !== void 0 && (e.editable = o.editable), o.namespace !== void 0 && (e.namespace = o.namespace), o.$initialEditorState !== void 0 && (e.$initialEditorState = o.$initialEditorState), o.nodes) for (let e of df(o)) {
				if (typeof e != "function") {
					let t = n.get(e.replace);
					t && $(302, o.name, e.replace.name, t.extension.name), n.set(e.replace, s);
				}
				t.add(e);
			}
			if (o.html) {
				if (o.html.export) for (let [e, t] of o.html.export.entries()) r.set(e, t);
				o.html.import && Object.assign(i, o.html.import);
			}
			o.theme && vf(a, o.theme);
		}
		Object.keys(a).length > 0 && (e.theme = a), t.size && (e.nodes = Array.from(t));
		let s = Object.keys(i).length > 0, c = r.size > 0;
		(s || c) && (e.html = {}, s && (e.html.import = i), c && (e.html.export = r));
		for (let t of o) t.init(e);
		return e.onError ||= Tf, e;
	}
};
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+extension@0.52.0_typescript@5.9.3/node_modules/@lexical/extension/dist/LexicalExtensionGetExtensionDependencyFromEditor.prod.js
function kf(e, t) {
	let n = Of.fromEditor(e).getExtensionRep(t);
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
var Af = class extends y.Component {
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
function jf({ children: e, fallback: t, onError: n }) {
	return (0, Q.jsx)(Af, {
		fallback: t === void 0 ? /*#__PURE__*/ (0, Q.jsx)("div", {
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
var Mf = { name: "@lexical/react/ReactProvider" };
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+react@0.52.0_react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@5.9.3_yjs@13.6.32/node_modules/@lexical/react/dist/LexicalReactExtension.prod.js
function Nf({ contentEditable: e, children: t }) {
	return (0, Q.jsxs)(Q.Fragment, { children: [e, t] });
}
var Pf = {
	build(e, t, n) {
		n.getPeer(Mf.name) || function(e, ...t) {
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
				let [n] = t, r = e.decorators.map((e) => typeof e == "function" ? /*#__PURE__*/ (0, Q.jsx)(e, { context: t }) : e);
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
									let e = /*#__PURE__*/ (0, Q.jsx)(t, {
										onError: n,
										children: /*#__PURE__*/ (0, Q.jsx)(y.Suspense, {
											fallback: null,
											children: i[a]
										})
									});
									r.push(/*#__PURE__*/ (0, Wd.createPortal)(e, o, a));
								}
							}
							return r;
						}, [
							t,
							i,
							e,
							a
						]);
					}(n, o), u = (0, y.useMemo)(() => r.map((e, t) => /*#__PURE__*/ (0, Q.jsx)(o, {
						onError: (e) => {
							n._onError(e);
						},
						children: /*#__PURE__*/ (0, Q.jsx)(y.Suspense, {
							fallback: null,
							children: e
						})
					}, t)), [o]);
					return (0, Q.jsx)(oe.Provider, {
						value: t,
						children: /*#__PURE__*/ (0, Q.jsxs)(a, {
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
		EditorChildrenComponent: Nf,
		ErrorBoundary: jf,
		contentEditable: /*#__PURE__*/ (0, Q.jsx)(rf, {}),
		decorators: []
	},
	mergeConfig(e, t) {
		let n = Md(e, t);
		return t.decorators && (n.decorators = t.decorators.length > 0 ? [...e.decorators, ...t.decorators] : e.decorators), n;
	},
	name: "@lexical/react/React",
	peerDependencies: [["@lexical/react/ReactProvider"]]
};
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+react@0.52.0_react-dom@19.2.8_react@19.2.8__react@19.2.8_typescript@5.9.3_yjs@13.6.32/node_modules/@lexical/react/dist/LexicalExtensionComposer.prod.js
function Ff({ extension: e, children: t, contentEditable: n }) {
	let r = (0, y.useMemo)(() => Of.fromExtensions([
		Mf,
		/* @__PURE__ */ jd(Pf, n === void 0 ? {} : { contentEditable: n }),
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
	let { Component: i } = kf(r, Pf).output;
	return (0, Q.jsx)(i, { children: t });
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+extension@0.52.0_typescript@5.9.3/node_modules/@lexical/extension/dist/LexicalExtensionGetPeerDependencyFromEditor.prod.js
function If(e, t) {
	let n = Of.maybeFromEditor(e);
	if (!n) return;
	let r = n.extensionNameMap.get(t);
	return r ? r.getExtensionDependency() : void 0;
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+selection@0.52.0_typescript@5.9.3/node_modules/@lexical/selection/dist/LexicalSelection.prod.js
function Lf(e) {
	let t = q().getElementByKey(e.getKey());
	if (t === null) return null;
	let n = t.ownerDocument.defaultView;
	return n === null ? null : n.getComputedStyle(t);
}
function Rf(e) {
	let t = ms(e) ? e : e.getParent();
	return t && Lf(t);
}
function zf(e, t, n = "self") {
	let r = e.getStartEndPoints();
	if (t.isSelected(e) && !_c(t) && r !== null) {
		let [i, a] = r, o = e.isBackward(), s = i.getNode(), c = a.getNode(), l = t.is(s), u = t.is(c);
		if (l || u) {
			let [r, i] = Ka(e), a = s.is(c), l = t.is(o ? c : s), u = t.is(o ? s : c), d, f = 0;
			a ? (f = r > i ? i : r, d = r > i ? r : i) : l ? (f = o ? i : r, d = void 0) : u && (f = 0, d = o ? r : i);
			let p = t.__text.slice(f, d);
			p !== t.__text && (n === "clone" && (t = Jl(t)), t.__text = p);
		}
	}
	return t;
}
function Bf(e) {
	let t = Vf(e);
	return t !== null && t.writingMode === "vertical-rl";
}
function Vf(e) {
	let t = e.anchor.getNode();
	return z(t) ? Lf(t) : Rf(t);
}
function Hf(e, t) {
	let n = Bf(e) ? !t : t;
	Wf(e) && (n = !n);
	let r = Os(e.focus, n ? "previous" : "next");
	if (Rs(r)) return !1;
	if (od(r) && !Ma(r.origin) && r.origin.isUnmergeable()) {
		let e = r.getNodeAtCaret();
		if (N(e) && !Ma(e)) return !0;
	}
	for (let e of X(r)) {
		if (cd(e)) return !e.origin.isInline();
		if (!z(e.origin)) {
			if (B(e.origin)) return !0;
			break;
		}
	}
	return !1;
}
function Uf(e, t, n, r) {
	e.modify(t ? "extend" : "move", n, r);
}
function Wf(e) {
	let t = Vf(e);
	return t !== null && t.direction === "rtl";
}
function Gf(e, t, n) {
	let r = Wf(e), i;
	i = Bf(e) || r ? !n : n, Uf(e, t, i, "character");
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+utils@0.52.0_typescript@5.9.3/node_modules/@lexical/utils/dist/LexicalUtils.prod.js
function Kf(e, t) {
	if (e == null) return !1;
	let n = Object.getPrototypeOf(e);
	return n != null && n.constructor != null && n.constructor.name === t.name;
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@preact+signals-core@1.14.4/node_modules/@preact/signals-core/dist/signals-core.module.js
var qf = Symbol.for("preact-signals");
function Jf() {
	if (ep > 1) ep--;
	else {
		var e, t = !1;
		for ((function() {
			var e = ip;
			for (ip = void 0; e !== void 0;) {
				var t = e.S;
				if (t.v === e.v) for (var n = t.t; n !== void 0; n = n.x) n.i === e.i && (n.i = t.i);
				e = e.o;
			}
		})(); $f !== void 0;) {
			var n = $f;
			for ($f = void 0, tp++; n !== void 0;) {
				var r = n.u;
				if (n.u = void 0, n.f &= -3, !(8 & n.f) && lp(n)) try {
					n.c();
				} catch (n) {
					t ||= (e = n, !0);
				}
				n = r;
			}
		}
		if (tp = 0, ep--, t) throw e;
	}
}
function Yf(e) {
	if (ep > 0) return e();
	rp = ++np, ep++;
	try {
		return e();
	} finally {
		Jf();
	}
}
var Xf, Zf = void 0;
function Qf(e) {
	var t = Zf, n = Xf;
	Zf = void 0, Xf = void 0;
	try {
		return e();
	} finally {
		Zf = t, Xf = n;
	}
}
var $f = void 0, ep = 0, tp = 0, np = 0, rp = 0, ip = void 0, ap = 0;
function op(e) {
	if (Zf !== void 0) {
		var t = e.n;
		if (t === void 0 || t.t !== Zf) return t = {
			i: 0,
			S: e,
			p: Zf.s,
			n: void 0,
			t: Zf,
			e: void 0,
			x: void 0,
			r: t
		}, Zf.s !== void 0 && (Zf.s.n = t), Zf.s = t, e.n = t, 32 & Zf.f && e.S(t), t;
		if (t.i === -1) return t.i = 0, t.n !== void 0 && (t.n.p = t.p, t.p !== void 0 && (t.p.n = t.n), t.p = Zf.s, t.n = void 0, Zf.s.n = t, Zf.s = t), t;
	}
}
function sp(e, t) {
	this.v = e, this.i = 0, this.n = void 0, this.t = void 0, this.l = 0, this.W = t?.watched, this.Z = t?.unwatched, this.name = t?.name;
}
sp.prototype.brand = qf, sp.prototype.h = function() {
	return !0;
}, sp.prototype.S = function(e) {
	var t = this, n = this.t;
	n !== e && e.e === void 0 && (e.x = n, this.t = e, n === void 0 ? Qf(function() {
		var e;
		(e = t.W) == null || e.call(t);
	}) : n.e = e);
}, sp.prototype.U = function(e) {
	var t = this;
	if (this.t !== void 0) {
		var n = e.e, r = e.x;
		n !== void 0 && (n.x = r, e.e = void 0), r !== void 0 && (r.e = n, e.x = void 0), e === this.t && (this.t = r, r === void 0 && Qf(function() {
			var e;
			(e = t.Z) == null || e.call(t);
		}));
	}
}, sp.prototype.subscribe = function(e) {
	var t = this;
	return _p(function() {
		var n = t.value;
		Qf(function() {
			return e(n);
		});
	}, { name: "sub" });
}, sp.prototype.valueOf = function() {
	return this.value;
}, sp.prototype.toString = function() {
	return this.value + "";
}, sp.prototype.toJSON = function() {
	return this.value;
}, sp.prototype.peek = function() {
	var e = this;
	return Qf(function() {
		return e.value;
	});
}, Object.defineProperty(sp.prototype, "value", {
	get: function() {
		var e = op(this);
		return e !== void 0 && (e.i = this.i), this.v;
	},
	set: function(e) {
		if (e !== this.v) {
			if (tp > 100) throw Error("Cycle detected");
			(function(e) {
				ep !== 0 && tp === 0 && e.l !== rp && (e.l = rp, ip = {
					S: e,
					v: e.v,
					i: e.i,
					o: ip
				});
			})(this), this.v = e, this.i++, ap++, ep++;
			try {
				for (var t = this.t; t !== void 0; t = t.x) t.t.N();
			} finally {
				Jf();
			}
		}
	}
});
function cp(e, t) {
	return new sp(e, t);
}
function lp(e) {
	for (var t = e.s; t !== void 0; t = t.n) if (t.S.i !== t.i || !t.S.h() || t.S.i !== t.i) return !0;
	return !1;
}
function up(e) {
	for (var t = e.s; t !== void 0; t = t.n) {
		var n = t.S.n;
		if (n !== void 0 && (t.r = n), t.S.n = t, t.i = -1, t.n === void 0) {
			e.s = t;
			break;
		}
	}
}
function dp(e) {
	for (var t = e.s, n = void 0; t !== void 0;) {
		var r = t.p;
		t.i === -1 ? (t.S.U(t), r !== void 0 && (r.n = t.n), t.n !== void 0 && (t.n.p = r)) : n = t, t.S.n = t.r, t.r !== void 0 && (t.r = void 0), t = r;
	}
	e.s = n;
}
function fp(e, t) {
	sp.call(this, void 0, t), this.x = e, this.s = void 0, this.g = ap - 1, this.f = 4;
}
fp.prototype = new sp(), fp.prototype.h = function() {
	if (this.f &= -3, 1 & this.f) return !1;
	if ((36 & this.f) == 32 || (this.f &= -5, this.g === ap)) return !0;
	if (this.g = ap, this.f |= 1, this.i > 0 && !lp(this)) return this.f &= -2, !0;
	var e = Zf;
	try {
		up(this), Zf = this;
		var t = this.x();
		(16 & this.f || this.v !== t || this.i === 0) && (this.v = t, this.f &= -17, this.i++);
	} catch (e) {
		this.v = e, this.f |= 16, this.i++;
	}
	return Zf = e, dp(this), this.f &= -2, !0;
}, fp.prototype.S = function(e) {
	if (this.t === void 0) {
		this.f |= 36;
		for (var t = this.s; t !== void 0; t = t.n) t.S.S(t);
	}
	sp.prototype.S.call(this, e);
}, fp.prototype.U = function(e) {
	if (this.t !== void 0 && (sp.prototype.U.call(this, e), this.t === void 0)) {
		this.f &= -33;
		for (var t = this.s; t !== void 0; t = t.n) t.S.U(t);
	}
}, fp.prototype.N = function() {
	if (!(2 & this.f)) {
		this.f |= 6;
		for (var e = this.t; e !== void 0; e = e.x) e.t.N();
	}
}, Object.defineProperty(fp.prototype, "value", { get: function() {
	if (1 & this.f) throw Error("Cycle detected");
	var e = op(this);
	if (this.h(), e !== void 0 && (e.i = this.i), 16 & this.f) throw this.v;
	return this.v;
} });
function pp(e) {
	var t = e.m;
	if (e.m = void 0, typeof t == "function") {
		ep++;
		var n = Zf;
		Zf = void 0;
		try {
			t();
		} catch (t) {
			throw e.f &= -2, e.f |= 8, mp(e), t;
		} finally {
			Zf = n, Jf();
		}
	}
}
function mp(e) {
	for (var t = e.s; t !== void 0; t = t.n) t.S.U(t);
	e.x = void 0, e.s = void 0, pp(e);
}
function hp(e) {
	if (Zf !== this) throw Error("Out-of-order effect");
	dp(this), Zf = e, this.f &= -2, 8 & this.f && mp(this), Jf();
}
function gp(e, t) {
	this.x = e, this.m = void 0, this.s = void 0, this.u = void 0, this.f = 32, this.name = t?.name, Xf && Xf.push(this);
}
gp.prototype.c = function() {
	var e = this.S();
	try {
		if (8 & this.f || this.x === void 0) return;
		var t = this.x();
		typeof t == "function" && (this.m = t);
	} finally {
		e();
	}
}, gp.prototype.S = function() {
	if (1 & this.f) throw Error("Cycle detected");
	this.f |= 1, this.f &= -9, pp(this), up(this), ep++;
	var e = Zf;
	return Zf = this, hp.bind(this, e);
}, gp.prototype.N = function() {
	2 & this.f || (this.f |= 2, this.u = $f, $f = this);
}, gp.prototype.d = function() {
	this.f |= 8, 1 & this.f || mp(this);
}, gp.prototype.dispose = function() {
	this.d();
};
function _p(e, t) {
	var n = new gp(e, t);
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
function vp(e, t) {
	let n;
	return cp(e(), {
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
function yp(e, ...t) {
	throw function(e, ...t) {
		let n = new URL("https://lexical.dev/docs/error"), r = new URLSearchParams();
		r.append("code", e);
		for (let e of t) r.append("v", e);
		return n.search = r.toString(), /* @__PURE__ */ Error(`Minified Lexical error #${e}; visit ${n.toString()} for the full message or use the non-minified dev environment for full errors and additional helpful warnings.`);
	}(e, ...t);
}
var bp;
function xp(e, t) {
	let { key: n } = t;
	return e && n in e ? e[n] : t.defaultValue;
}
function Sp(e) {
	return bp && bp.editor === e ? bp : void 0;
}
function Cp(e, t) {
	if ("cfg" in t) {
		let { cfg: n, updater: r } = t;
		return [n, r(xp(e, n))];
	}
	return t;
}
function wp(e, t) {
	let n = t;
	for (let r of e) {
		let [e, i] = Cp(n, r), a = e.key;
		if (n === t && xp(n, e) === i) continue;
		let o = n === t || n === void 0 ? Tp(t) : n;
		o[a] = i, n = o;
	}
	return n;
}
function Tp(e) {
	return Object.create(e || null);
}
function Ep(e, t) {
	return [e, t];
}
function Dp(e, t, n, r = q()) {
	let i = bp, a = Sp(r);
	try {
		return bp = {
			...a,
			editor: r,
			[e]: t
		}, n();
	} finally {
		bp = i;
	}
}
function Op(e, t = () => {}) {
	return (n, r = q()) => (i) => {
		let a = Sp(r), o = a && a[e], s = wp(n, o || t(r));
		return s && s !== o ? Dp(e, s, i, r) : i();
	};
}
function kp(e, t, n, r) {
	return Object.assign(Vt(Symbol(t), {
		isEqual: r,
		parse: n
	}), { [e]: !0 });
}
var Ap = "@lexical/html/DOM", jp = Symbol.for("@lexical/html/DOMExportContext");
function Mp(e, t, n) {
	return kp(jp, e, t, n);
}
var Np = /* @__PURE__ */ Mp("isExport", Boolean);
function Pp(e) {
	let t = If(e, Ap);
	return t ? t.output.defaults : void 0;
}
function Fp(e) {
	let t = If(e, Ap);
	return t ? t.output.runtime : void 0;
}
function Ip(e = q()) {
	let t = Fp(e);
	return t ? t.getSessionConfig() : J(e);
}
var Lp = /* @__PURE__ */ Op(jp, Pp);
function Rp(e, t = null, n = q()) {
	return Lp([Ep(Np, !0)], n)(() => {
		let r = Nc(), i = Ip(n), a = zu(t), o = e.append.bind(e);
		for (let e of (z(a) ? a : r).getChildren()) Bp(n, e, o, t, i);
		return e;
	});
}
function zp(e, t = null) {
	return (typeof document > "u" || typeof window > "u" && global.window === void 0) && yp(338), Vo(e), Rp(Dl().createElement("div"), t, e).innerHTML;
}
function Bp(e, t, n, r = null, i = J(e)) {
	let a = i.$shouldInclude(t, r, e), o = i.$shouldExclude(t, r, e), s = t;
	r !== null && N(t) && (s = zf(r, t, "clone"));
	let { element: c, after: l, append: u, $getChildNodes: d } = i.$exportDOM(s, e);
	if (!c) return !1;
	let f = Dl().createDocumentFragment(), p = d ? d() : z(s) ? s.getChildren() : [], m = a && Ha(r) && z(t) ? null : r, h = f.append.bind(f), g = null;
	for (let n of p) {
		let o = Bp(e, n, h, m, i);
		o && (g = n), !a && o && i.$extractWithChild(t, n, r, "html", e) && (a = !0);
	}
	if (a && !o) {
		if ((U(c) || Rl(c)) && (u ? u(f) : c.append(f), function(e, t) {
			let n = e.lastChild;
			if (ws(t) && U(e) && G(e) && n !== null && n.nodeName === "BR") {
				let t = Dl().createElement("br");
				t.setAttribute("data-lexical-managed-linebreak", "true"), e.append(t);
			}
		}(c, g)), Rl(c)) {
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
function Vp(e, t, n = null) {
	let r = El(n), i = n ? wl(n) : [], a = n !== null && i.length > 0;
	if (a && typeof r.caretPositionFromPoint == "function") {
		let a = r.caretPositionFromPoint(e, t, { shadowRoots: i });
		if (a !== null && function(e, t) {
			for (let n = e; n !== null;) {
				if (n === t) return !0;
				n = tl(n);
			}
			return !1;
		}(a.offsetNode, n)) return {
			node: a.offsetNode,
			offset: a.offset
		};
	}
	if (a) {
		let i = n.getRootNode();
		if (Sl(i)) {
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
function Hp(e, ...t) {
	throw function(e, ...t) {
		let n = new URL("https://lexical.dev/docs/error"), r = new URLSearchParams();
		r.append("code", e);
		for (let e of t) r.append("v", e);
		return n.search = r.toString(), /* @__PURE__ */ Error(`Minified Lexical error #${e}; visit ${n.toString()} for the full message or use the non-minified dev environment for full errors and additional helpful warnings.`);
	}(e, ...t);
}
function Up(e, t = F()) {
	return t ?? Hp(166), P(t) && t.isCollapsed() || t.getNodes().length === 0 ? "" : zp(e, t);
}
function Wp(e, t) {
	let n = e.getData("text/plain") || e.getData("text/uri-list");
	n != null && t.insertRawText(n);
}
var Gp = "application/x-lexical-drag";
function Kp(e, t) {
	let n = { editorKey: t.getKey() };
	e.setData(Gp, JSON.stringify(n));
}
function qp(e) {
	let t = e;
	if (od(t)) {
		if (t.offset === 0) t = Ns(t.getSiblingCaret());
		else {
			if (t.offset !== t.origin.getTextContentSize()) return t;
			t = t.getSiblingCaret();
		}
	}
	for (;;) {
		let e = t.getParentAtCaret();
		if (e === null || !e.isInline() || e.isShadowRoot()) return t;
		if (cd(t)) t = Ns(fd(e, "next"));
		else {
			if (t.getNodeAtCaret() !== null) return t;
			t = fd(e, "next");
		}
	}
}
function Jp(e, t, n) {
	let r = e.dataTransfer;
	if (r === null) return !1;
	let i = function(e) {
		let t = e.getData(Gp);
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
		let n = Vp(e.clientX, e.clientY, t.getRootElement());
		if (n === null) return null;
		let r = Ac(n.node);
		if (r === null) return null;
		if (N(r)) return pd(r, "next", n.offset);
		if (z(r)) return Bs(r, n.offset, "next");
		let i = r.getParent();
		return i === null ? null : Bs(i, r.getIndexWithinParent() + 1, "next");
	}(e, t);
	if (a === null) return !1;
	let o = i.editorKey === t.getKey(), s = F();
	if (o) {
		if (!P(s) || s.isCollapsed()) return !1;
		if (function(e, t) {
			let { anchor: n, focus: r } = zs(Ms(t), "next"), i = qp(e);
			return Td(qp(n), i) <= 0 && Td(i, qp(r)) <= 0;
		}(a, s)) return e.preventDefault(), !0;
	}
	let c = Ls(a), l = od(c) ? Us(c) : c;
	if (l === null) return !1;
	let u = l.getFlipped();
	o && P(s) && s.removeText();
	let d = l.origin.isAttached() ? l : u;
	if (d.origin.isAttached() || Hp(438), n(r, As(Sd(d)), t), !o) {
		let e = t.getRootElement(), n = e ? e.ownerDocument : null, r = n ? function(e, t) {
			for (let n of Tl(t)) {
				let t = hc(n);
				if (pc(t) && t.getKey() === e && U(n)) return n;
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
function Yp(e, t) {
	return Jp(e, t, (e, t) => Wp(e, t));
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+extension@0.52.0_typescript@5.9.3/node_modules/@lexical/extension/dist/LexicalExtensionNamedSignals.prod.js
function Xp(e, t = {}) {
	let n = {};
	for (let r in e) {
		let i = t[r];
		n[r] = cp(i === void 0 ? e[r] : i);
	}
	return n;
}
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+dragon@0.52.0_typescript@5.9.3/node_modules/@lexical/dragon/dist/LexicalDragon.prod.js
var Zp = {
	bold: "bold",
	italic: "italic",
	strikeThrough: "strikethrough",
	subscript: "subscript",
	superscript: "superscript",
	underline: "underline"
}, Qp = Symbol.for("@lexical/dragon/WindowState");
function $p(e, t, n) {
	let r = function(e) {
		let t = e[Qp];
		return t === void 0 && (t = {
			dispose: () => {},
			editors: /* @__PURE__ */ new Map(),
			installs: /* @__PURE__ */ new Set()
		}, e[Qp] = t), t;
	}(e);
	if (r.installs.size === 0) {
		let t = rm.bind(e);
		e.addEventListener("message", t, !0), r.dispose = () => {
			e.removeEventListener("message", t, !0);
		};
	}
	if (r.installs.add(t), n) {
		let e = r.editors.get(n) || /* @__PURE__ */ new Set();
		e.add(t), r.editors.set(n, e);
	}
	return em.bind(null, e, r, t, n);
}
function em(e, t, n, r) {
	if (r) {
		let e = t.editors.get(r);
		e && e.delete(n) && e.size === 0 && t.editors.delete(r);
	}
	t.installs.delete(n) && t.installs.size === 0 && (t.dispose(), delete e[Qp]);
}
function tm(e) {
	return e && e.ownerDocument.defaultView;
}
function nm(e) {
	let t = vp(() => tm(e.getRootElement()), (t) => e.registerRootListener((e) => {
		t.value = tm(e);
	}));
	return _p(() => {
		let n = t.value;
		if (n) return $p(n, Symbol("@lexical/dragon/editorInstall"), e);
	});
}
function rm(e) {
	if (e.origin !== this.location.origin) return;
	let t = function(e) {
		let t = e[Qp];
		if (t === void 0) return null;
		let n = hc(Fl(e.document));
		return pc(n) && t.editors.has(n) ? n : null;
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
								let e = Zp[c];
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
var im = {
	build: (e, t, n) => Xp(t),
	config: { disabled: typeof window > "u" },
	name: "@lexical/dragon",
	register: (e, t, n) => _p(() => n.getOutput().disabled.value ? void 0 : nm(e))
};
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+extension@0.52.0_typescript@5.9.3/node_modules/@lexical/extension/dist/LexicalExtensionNormalizeInlineElementsExtension.prod.js
function am(e) {
	z(e) && e.isInline() && e.isEmpty() && e.remove();
}
var om = {
	build: (e, t, n) => Xp(t),
	config: { disabled: !1 },
	name: "@lexical/NormalizeInlineElements",
	register: (e, t, n) => {
		let r = n.getOutput();
		return _p(() => {
			if (!r.disabled.value) {
				let t = [];
				for (let { klass: n, transforms: r } of e._nodes.values()) n.prototype instanceof us && n.prototype.isInline !== us.prototype.isInline && (r.add(am), t.push(() => r.delete(am)));
				return () => t.forEach((e) => e());
			}
		});
	}
}, sm = /* @__PURE__ */ new Set([Xi, Ji]), cm = {
	build: (e, t, n) => Xp(t),
	config: {
		$fixFocusOverselection: function() {
			let e = F();
			if (P(e) && !e.isCollapsed()) {
				let t = zs(Ms(e), "next"), n = t.focus;
				for (od(n) && t.anchor.origin !== n.origin && n.offset === 0 && (n = Ns(n.getSiblingCaret())), sd(n) && t.anchor.origin !== n.origin && ws(n.origin) && (n = Ns(n)); cd(n) && t.anchor.origin !== n.origin;) n = Ns(fd(n.origin, "next"));
				if (sd(n) && z(n.origin) && (n = Ls(gd(n.origin, "previous")).getFlipped()), n = Ls(n), !n.isSamePointCaret(t.focus)) {
					let e = As(Cd(t.anchor, n)), r = q().getRootElement(), i = r && bl(r.ownerDocument.defaultView);
					i && yo(po(), e, q(), i, sm, r);
				}
			}
		},
		dateNow: () => Date.now(),
		disabled: !1,
		thresholdMsec: 100
	},
	name: "@lexical/NormalizeTripleClickSelection",
	register: (e, t, n) => _p(() => {
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
			return Pd(e.registerCommand(rr, () => (i(null) && (r = 0, t.$fixFocusOverselection.peek()()), !1), -4), Z(n, {
				mousedown: i,
				mouseup: i
			}, !0));
		});
	})
};
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+plain-text@0.52.0_typescript@5.9.3/node_modules/@lexical/plain-text/dist/LexicalPlainText.prod.js
function lm(e, t) {
	t.update(() => {
		if (e !== null) {
			let n = Kf(e, KeyboardEvent) ? null : e.clipboardData, r = F();
			if (r !== null && !r.isCollapsed() && n != null) {
				e.preventDefault();
				let i = Up(t);
				i !== null && n.setData("text/html", i), n.setData("text/plain", r.getTextContent());
			}
		}
	});
}
function um(e) {
	return Pd(e.registerCommand(lr, (e) => {
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
			if (n != null) Wp(n, t);
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
		return !!Hf(t, !0) && (n.preventDefault(), Gf(t, r, !0), !0);
	}, 0), e.registerCommand(xr, (e) => {
		let t = F();
		if (!P(t)) return !1;
		let n = e, r = n.shiftKey;
		return !!Hf(t, !1) && (n.preventDefault(), Gf(t, r, !1), !0);
	}, 0), e.registerCommand(kr, (t) => !!P(F()) && (!ve || !ge) && (t.preventDefault(), e.dispatchCommand(lr, !0)), 0), e.registerCommand(jr, (t) => !!P(F()) && (t.preventDefault(), e.dispatchCommand(lr, !1)), 0), e.registerCommand(Dr, (t) => {
		if (!P(F())) return !1;
		if (t !== null) {
			if ((ve || be || Ce) && ge) return !1;
			t.preventDefault();
		}
		return e.dispatchCommand(ur, !1);
	}, 0), e.registerCommand(zr, () => {
		let e = F();
		return qc(P(e) && Ru(e.anchor.getNode()) !== null ? e : null), !0;
	}, 0), e.registerCommand(Lr, (t) => !!P(F()) && (lm(t, e), !0), 0), e.registerCommand(Rr, (t) => !!P(F()) && (function(e, t) {
		lm(e, t), t.update(() => {
			let e = F();
			P(e) && e.removeText();
		}, { tag: "cut" });
	}(t, e), !0), 0), e.registerCommand(pr, (t) => !!P(F()) && (function(e, t) {
		e.preventDefault(), t.update(() => {
			let t = F(), n = Kf(e, ClipboardEvent) ? e.clipboardData : null;
			n != null && P(t) && Wp(n, t);
		}, { tag: "paste" });
	}(t, e), !0), 0), e.registerCommand(Nr, (t) => Yp(t, e), 0), e.registerCommand(Pr, (t) => {
		let n = F();
		return !!P(n) && (n.isCollapsed() || t.dataTransfer === null || Kp(t.dataTransfer, e), !0);
	}, 0));
}
var dm = {
	conflictsWith: ["@lexical/rich-text"],
	dependencies: [
		im,
		om,
		cm
	],
	name: "@lexical/plain-text",
	register: um
};
//#endregion
//#region ../../../../typescript/node_modules/.pnpm/@lexical+history@0.52.0_typescript@5.9.3/node_modules/@lexical/history/dist/LexicalHistory.prod.js
function fm(e, t, n) {
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
					n === void 0 || ms(n) || i.push(n);
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
function pm(e, t) {
	if (t !== null && t.editor === e.editor) return t;
	let { editor: n } = e, r = n.getEditorState();
	return r.isEmpty() ? null : {
		editor: n,
		editorState: r
	};
}
function mm(e, t) {
	e.undoStack = [], e.redoStack = [], e.current = null, t && t(e);
}
function hm(e, t, n, r = Date.now, i, a = null) {
	let o = fm(e, n, r), s = () => {
		i && i(t);
	};
	return s(), Pd(e.registerCommand(vr, () => (function(e, t, n) {
		let r = t.redoStack, i = t.undoStack;
		if (i.length !== 0) {
			let a = t.current, o = i.pop();
			if (o) {
				let t = pm(o, a);
				t !== null && (r.push(t), e.dispatchCommand(Hr, !0));
			}
			i.length === 0 && e.dispatchCommand(Ur, !1), t.current = o || null, n && n(t), o && o.editor.setEditorState(o.editorState, { tag: "historic" });
		}
	}(e, t, i), !0), 0), e.registerCommand(yr, () => (function(e, t, n) {
		let r = t.redoStack, i = t.undoStack;
		if (r.length !== 0) {
			let a = t.current, o = r.pop();
			if (o) {
				let t = pm(o, a);
				t !== null && (i.push(t), e.dispatchCommand(Ur, !0));
			}
			r.length === 0 && e.dispatchCommand(Hr, !1), t.current = o || null, n && n(t), o && o.editor.setEditorState(o.editorState, { tag: "historic" });
		}
	}(e, t, i), !0), 0), e.registerCommand(Br, () => (mm(t, i), !1), 0), e.registerCommand(Vr, () => (mm(t, i), e.dispatchCommand(Hr, !1), e.dispatchCommand(Ur, !1), !0), 0), e.registerUpdateListener(({ editorState: n, prevEditorState: r, dirtyLeaves: i, dirtyElements: c, tags: l }) => {
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
function gm() {
	return {
		current: null,
		redoStack: [],
		undoStack: []
	};
}
var _m = {
	build: (e, { delay: t, createInitialHistoryState: n, disabled: r, maxDepth: i, now: a }, o) => ({
		...Xp({
			delay: t,
			disabled: r,
			historyState: n(e),
			maxDepth: i,
			now: a
		}),
		...o.getInitResult()
	}),
	config: {
		createInitialHistoryState: gm,
		delay: 300,
		disabled: typeof window > "u",
		maxDepth: null,
		now: () => Date.now()
	},
	init: () => ({
		canRedo: cp(!1),
		canUndo: cp(!1)
	}),
	name: "@lexical/history/History",
	register: (e, t, n) => {
		let { canUndo: r, canRedo: i } = n.getInitResult(), a = n.getOutput(), o = (e) => Yf(() => {
			r.value = e != null && e.undoStack.length > 0, i.value = e != null && e.redoStack.length > 0;
		});
		return _p(() => {
			if (!a.disabled.value) return hm(e, a.historyState.value, a.delay, () => a.now.peek()(), o, a.maxDepth);
			o(null);
		});
	}
};
//#endregion
//#region ../../../../design/browser-ui/src/rich-input/document.ts
function vm() {
	return Nc().getChildren().map((e) => e.getTextContent()).join("\n");
}
function ym(e, t = []) {
	let n = Nc();
	n.clear();
	let r = 0;
	for (let i of e.split("\n")) {
		let e = Js(), a = 0;
		for (let n of t) {
			let t = n.range.start - r, o = n.range.end - r;
			t < a || o <= t || o > i.length || (t > a && e.append(Da(i.slice(a, t))), e.append(n.create(i.slice(t, o))), a = o);
		}
		a < i.length && e.append(Da(i.slice(a))), n.append(e), r += i.length + 1;
	}
	n.selectEnd();
}
function bm() {
	ym(""), Fc(null);
}
function xm(e, t) {
	let n = lo();
	function r(e, t) {
		let n = 0, r = Nc().getChildren();
		for (let i of r) {
			let r = i.getTextContentSize();
			if (t <= n + r && z(i)) {
				function r(t, n) {
					if (!z(t)) return;
					let i = t.getChildren();
					for (let a = 0; a < i.length; a++) {
						let o = i[a], s = o.getTextContentSize();
						if (n <= s) {
							N(o) ? e.set(o.getKey(), n, "text") : z(o) ? r(o, n) : e.set(t.getKey(), a + +(n > 0), "element");
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
		z(i) && e.set(i.getKey(), i.getChildrenSize(), "element");
	}
	return r(n.anchor, e), r(n.focus, t), Fc(n), n;
}
//#endregion
//#region ../../../../design/browser-ui/src/rich-input/core.tsx
var Sm = "parent-rich-input-reset", Cm = Ad({
	name: "TmtRichInput",
	namespace: "TmtRichInput",
	nodes: [lf],
	dependencies: [
		dm,
		_m,
		Pf
	],
	$initialEditorState: bm,
	onError: (e) => {
		throw e;
	}
});
function wm(e) {
	return /* @__PURE__ */ (0, Q.jsxs)(Ff, {
		extension: Cm,
		contentEditable: null,
		children: [/* @__PURE__ */ (0, Q.jsx)(Tm, { ...e }), e.children]
	});
}
function Tm(e) {
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
				e.document.replace(e.edit), n || Fc(null);
			}, {
				tag: n ? Sm : [Sm, Yi],
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
function Em(e) {
	let [t] = se(), n = (0, y.useId)();
	return /* @__PURE__ */ (0, Q.jsx)(Gd, {
		controlId: n,
		label: e.label,
		describedByIds: e.describedBy ? [e.describedBy] : [],
		renderControl: (n) => {
			let r = /* @__PURE__ */ (0, Q.jsx)(rf, {
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
			return /* @__PURE__ */ (0, Q.jsxs)("div", {
				className: "rich-input-surface",
				"data-accessory": !!e.accessory || void 0,
				"data-disabled": e.disabled && !e.busy || void 0,
				children: [
					e.header,
					r,
					e.accessory && /* @__PURE__ */ (0, Q.jsx)("div", {
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
var Dm = {
	read: () => ({ value: vm() }),
	replace: (e) => ym(e.value),
	equal: (e, t) => e.value === t.value
};
function Om() {
	let [e] = se();
	return (0, y.createElement)(Jd, {
		type: "button",
		variant: "text",
		label: "Mention an agent",
		icon: (0, y.createElement)(ne),
		onActivate: (t) => {
			t.isTrusted && (e.update(() => {
				let e = F();
				if (!P(e)) {
					let t = vm().length;
					xm(t, t), e = F();
				}
				P(e) && e.insertText("@");
			}, {
				tag: Ki,
				discrete: !0
			}), e.focus());
		}
	});
}
function km({ options: e }) {
	let [t, n] = (0, y.useState)({}), [r, i] = (0, y.useState)(0), a = (0, y.useRef)(e.cleared);
	(0, y.useEffect)(() => {
		a.current !== e.cleared && (a.current = e.cleared, n((t) => ({
			...t,
			[e.key]: ""
		})), i((e) => e + 1));
	}, [e.cleared, e.key]);
	let o = t[e.key] ?? "", s = e.canSend && !e.busy && o.trim() !== "", c = () => {
		s && e.onSend?.(o);
	}, l = (0, y.createElement)(Em, {
		label: e.label,
		placeholder: e.placeholder,
		disabled: e.busy,
		busy: e.busy,
		className: "ops-composer-field",
		describedBy: e.describedBy,
		accessory: (0, y.createElement)("div", { className: "ops-composer-actions" }, (0, y.createElement)(Om), (0, y.createElement)("span", { className: "ops-composer-hint" }, e.hint), (0, y.createElement)(Jd, {
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
	return (0, y.createElement)(wm, {
		edit: { value: o },
		onChange: (t) => n((n) => ({
			...n,
			[e.key]: t.value
		})),
		document: Dm,
		disabled: e.busy,
		resetKey: `${e.key}:${r}`,
		children: l
	});
}
function Am(e, t) {
	let n = (0, ae.createRoot)(e), r = (e) => n.render((0, y.createElement)(km, { options: e }));
	return r(t), {
		update: r,
		unmount: () => n.unmount()
	};
}
//#endregion
export { Am as mountComposer };
