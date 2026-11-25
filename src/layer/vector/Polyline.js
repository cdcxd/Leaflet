import {Path} from './Path.js';
import * as Util from '../../core/Util.js';
import * as LineUtil from '../../geometry/LineUtil.js';
import {LatLng} from '../../geo/LatLng.js';
import {LatLngBounds} from '../../geo/LatLngBounds.js';
import {Bounds} from '../../geometry/Bounds.js';
import {Point} from '../../geometry/Point.js';
import {CRS} from '../../geo/crs/CRS.js';
import {Transformation} from '../../geometry/Transformation.js';
import {latLngsToCoords, getFeature} from '../GeoJSONUtil.js';

/** @import {Feature, Geometry, LineString, MultiLineString} from 'geojson' */
/** @import {Defaults, InteractiveLayerEventMap, LatLngExpression, NestedCoords, PolylineDefaults, PolylineOptions} from '../../types.js' */

const defaultOptions = {
	/**
	 * How much to simplify the polyline on each zoom level (Douglas–Peucker epsilon, in pixels). Higher values
	 * mean faster rendering but less accuracy; lower values mean more accuracy but slower rendering.
	 */
	smoothFactor: 0.5,

	/** Disable polyline clipping. */
	noClip: false
};

/** @typedef {typeof defaultOptions} PolylineDefaultsValues */

/**
 * A class for drawing polyline overlays on a map. Extends `Path`.
 * @example
 * ```js
 * // create a red polyline from an array of LatLng points
 * const latlngs = [
 * 	[45.51, -122.68],
 * 	[37.77, -122.43],
 * 	[34.04, -118.2]
 * ];
 *
 * const polyline = new Polyline(latlngs, {color: 'red'}).addTo(map);
 *
 * // zoom the map to the polyline
 * map.fitBounds(polyline.getBounds());
 * ```
 *
 * You can also pass a multi-dimensional array to represent a `MultiPolyline` shape:
 *
 * ```js
 * // create a red polyline from an array of arrays of LatLng points
 * const latlngs = [
 * 	[[45.51, -122.68],
 * 	 [37.77, -122.43],
 * 	 [34.04, -118.2]],
 * 	[[40.78, -73.91],
 * 	 [41.83, -87.62],
 * 	 [32.76, -96.72]]
 * ];
 * ```
 * @template {PolylineOptions} [O=PolylineOptions]
 * @template {InteractiveLayerEventMap} [E=InteractiveLayerEventMap]
 * @template {Geometry} [G=LineString | MultiLineString] the geometry `toGeoJSON` returns
 * @extends {Path<O & PolylineDefaults, E>}
 */
export class Polyline extends Path {

	static initHooks = true;

	/** @type {Defaults<PolylineOptions>} */
	static defaultOptions = defaultOptions;

	/**
	 * Instantiates a polyline object given an array of geographical points and optionally an options object. You
	 * can create a `Polyline` object with multiple separate lines (`MultiPolyline`) by passing an array of arrays
	 * of geographic points.
	 * @param {NestedCoords<LatLngExpression>} latlngs
	 * @param {NoInfer<Partial<O>>} [options]
	 */
	constructor(latlngs, options) {
		super();

		Util.setOptions(this, options);
		this._setLatLngs(latlngs);

		this.callInitHooks();
	}

	/**
	 * Returns an array of the points in the path, or nested arrays of points in case of multi-polyline.
	 * @returns {NestedCoords<LatLng>}
	 */
	getLatLngs() {
		return this._latlngs;
	}

	/**
	 * Replaces all the points in the polyline with the given array of geographical points.
	 * @param {NestedCoords<LatLngExpression>} latlngs
	 */
	setLatLngs(latlngs) {
		this._setLatLngs(latlngs);
		return this.redraw();
	}

	/** Returns `true` if the Polyline has no LatLngs. */
	isEmpty() {
		return !this._latlngs.length;
	}

	/**
	 * Returns the point closest to `p` on the Polyline, with its `distance` to `p`, or `null` when the polyline
	 * has no points on the screen.
	 * @param {Point} p
	 */
	closestLayerPoint(p) {
		p = new Point(p);
		let minDistance = Infinity,
		/** @type {Point | null} */
		minPoint = null,
		p1, p2;
		const closest = LineUtil._sqClosestPointOnSegment,
		closed = this._isClosed();

		for (const points of this._parts) {
			for (let i = closed ? 0 : 1, len = points.length; i < len; i++) {
				p1 = points[(i || len) - 1];
				p2 = points[i];

				const sqDist = closest(p, p1, p2, true);

				if (sqDist < minDistance) {
					minDistance = sqDist;
					minPoint = closest(p, p1, p2);
				}
			}
		}
		return minPoint && Object.assign(minPoint, {distance: Math.sqrt(minDistance)});
	}

	/** Returns the center ([centroid](https://en.wikipedia.org/wiki/Centroid)) of the polyline. */
	getCenter() {
		// throws error when not yet added to map as this center calculation requires projected coordinates
		if (!this._map) {
			throw new Error('Must add layer to map before using getCenter()');
		}
		return LineUtil.polylineCenter(this._defaultShape(), this._map.options.crs);
	}

	/** Returns the `LatLngBounds` of the path. */
	getBounds() {
		return this._bounds;
	}

	/**
	 * Adds a given point to the polyline. By default, adds to the first ring of the polyline
	 * in case of a multi-polyline, but can be overridden by passing a specific ring as a LatLng
	 * array (that you can earlier access with [`getLatLngs`](#polyline-getlatlngs)).
	 * @param {LatLngExpression} latlng
	 * @param {LatLng[]} [latlngs]
	 */
	addLatLng(latlng, latlngs) {
		latlngs ??= this._defaultShape();
		latlng = new LatLng(latlng);
		latlngs.push(/** @type {LatLng} */ (latlng));
		this._bounds.extend(latlng);
		return this.redraw();
	}

	/**
	 * Coordinates values are rounded with [`formatNum`](#util-formatnum) function with given
	 * `precision`. Returns a [`GeoJSON`](https://en.wikipedia.org/wiki/GeoJSON) representation
	 * of the polyline (as a GeoJSON `LineString` or `MultiLineString` Feature).
	 * @param {number | false} [precision]
	 * @returns {Feature<G>}
	 */
	toGeoJSON(precision) {
		const multi = !LineUtil.isFlat(this._latlngs);

		const coords = latLngsToCoords(this._latlngs, 0, false, precision);

		return getFeature(this, /** @type {G} */ ({
			type: `${multi ? 'Multi' : ''}LineString`,
			coordinates: coords
		}));
	}

	/** @param {NestedCoords<LatLngExpression>} latlngs */
	_setLatLngs(latlngs) {
		/** @type {LatLngBounds} */
		this._bounds = new LatLngBounds();
		/** @type {NestedCoords<LatLng>} */
		this._latlngs = this._convertLatLngs(latlngs);
	}

	/** @returns {LatLng[]} */

	_defaultShape() {
		return LineUtil.isFlat(this._latlngs) ? this._latlngs : /** @type {LatLng[]} */ (this._latlngs[0]);
	}

	// recursively convert latlngs input into actual LatLng instances; calculate bounds along the way
	/**
	 * @param {NestedCoords<LatLngExpression>} latlngs
	 * @returns {NestedCoords<LatLng>}
	 */
	_convertLatLngs(latlngs) {
		if (!LineUtil.isFlat(latlngs)) {
			return /** @type {NestedCoords<LatLng>} */ (latlngs.map(ring => this._convertLatLngs(ring)));
		}
		const result = [];
		for (let i = 0, len = latlngs.length; i < len; i++) {
			result[i] = new LatLng(latlngs[i]);
			this._bounds.extend(result[i]);
		}
		return result;
	}

	_project() {
		const pxBounds = new Bounds();
		/** @type {Point[][] | undefined} */
		this._lastRings = this._rings;
		/** @type {Point[][]} */
		this._rings = [];
		this._projectLatlngs(this._latlngs, this._rings, pxBounds);

		if (this._bounds.isValid() && pxBounds.isValid()) {
			/** @type {Bounds | undefined} */
			this._rawPxBounds = pxBounds;
			this._updateBounds();
		}
	}

	_updateBounds() {
		const w = this._clickTolerance(),
		p = new Point(w, w);

		if (!this._rawPxBounds) {
			return;
		}

		this._pxBounds = new Bounds([
			this._rawPxBounds.min.subtract(p),
			this._rawPxBounds.max.add(p)
		]);
	}

	// recursively turns latlngs into a set of rings with projected coordinates
	/**
	 * @param {NestedCoords<LatLng>} latlngs
	 * @param {Point[][]} result
	 * @param {Bounds} projectedBounds
	 */
	_projectLatlngs(latlngs, result, projectedBounds) {
		if (LineUtil.isFlat(latlngs)) {
			result.push(this._projectRing(latlngs, result.length, projectedBounds));
		} else {
			latlngs.forEach(latlng => this._projectLatlngs(latlng, result, projectedBounds));
		}
	}

	// The layer points of the k-th ring. The CRS's projection, the costly part, does not depend on the zoom: its result
	// is kept for each point, with the coordinates it came from, so that a zoom only scales and offsets it.
	/**
	 * @param {LatLng[]} latlngs
	 * @param {number} k
	 * @param {Bounds} projectedBounds extended with the ring's points
	 * @returns {Point[]}
	 */
	_projectRing(latlngs, k, projectedBounds) {
		const renderer = this._renderer,
		crs = this._map.options.crs,
		t = crs.transformation;

		// a CRS that projects otherwise
		if (crs.latLngToPoint !== CRS.latLngToPoint || t._transform !== Transformation.prototype._transform) {
			const ring = latlngs.map(latlng => renderer._latLngToLayerPoint(latlng));
			ring.forEach(r => projectedBounds.extend(r));
			return ring;
		}
		if (this._projectedCrs !== crs) {
			/** @type {typeof CRS | undefined} */
			this._projectedCrs = crs;
			/** @type {Float64Array[]} */
			this._projected = [];
		}

		const len = latlngs.length;
		let cache = this._projected[k];
		const fresh = cache?.length !== 4 * len;
		if (fresh) {
			cache = this._projected[k] = new Float64Array(4 * len);
		}

		const scale = crs.scale(renderer._pathZoom),
		origin = renderer._pathOrigin,
		// the points of the last projection are moved rather than made again: a million new points cost more than
		// projecting them
		last = this._lastRings?.[k],
		reuse = last?.length === len,
		ring = reuse ? last : new Array(len);
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

		for (let i = 0; i < len; i++) {
			const latlng = latlngs[i], j = 4 * i;
			let p;
			// new, or changed in place since
			if (fresh || cache[j] !== latlng.lat || cache[j + 1] !== latlng.lng) {
				p = crs.projection.project(latlng);
				cache[j] = latlng.lat;
				cache[j + 1] = latlng.lng;
				cache[j + 2] = p.x;
				cache[j + 3] = p.y;
			}
			// as crs.latLngToPoint and the renderer's offset
			const x = scale * (t._a * cache[j + 2] + t._b) - origin.x,
			y = scale * (t._c * cache[j + 3] + t._d) - origin.y;
			if (reuse) {
				p = ring[i];
			} else {
				p ??= new Point(0, 0);
				ring[i] = p;
			}
			p.x = x;
			p.y = y;
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
		if (len) {
			projectedBounds.extend(new Point(minX, minY));
			projectedBounds.extend(new Point(maxX, maxY));
		}
		return ring;
	}

	// clip polyline by renderer bounds so that we have less to render for performance
	_clipPoints() {
		const bounds = this._renderer._bounds;

		/** @type {Point[][]} */
		this._parts = [];
		if (!this._pxBounds?.intersects(bounds)) {
			return;
		}

		if (this.options.noClip) {
			this._parts = this._rings;
			return;
		}

		const parts = this._parts;
		let k = 0;

		for (const points of this._rings) {
			for (let j = 0, len = points.length; j < len - 1; j++) {
				const segment = LineUtil.clipSegment(points[j], points[j + 1], bounds, !!j);

				if (!segment) { continue; }

				parts[k] ??= [];
				parts[k].push(segment[0]);

				// if segment goes out of screen, or it's the last one, it's the end of the line part
				if ((segment[1] !== points[j + 1]) || (j === len - 2)) {
					parts[k].push(segment[1]);
					k++;
				}
			}
		}
	}

	// simplify each clipped part of the polyline for performance
	_simplifyPoints() {
		const parts = this._parts,
		tolerance = this.options.smoothFactor;

		for (let i = 0, len = parts.length; i < len; i++) {
			parts[i] = LineUtil.simplify(parts[i], tolerance);
		}
	}

	_update() {
		if (!this._map) { return; }

		this._clipPoints();
		this._simplifyPoints();
		this._updatePath();
	}

	_updatePath() {
		this._renderer._updatePoly(this);
	}

	// polygon rings also have a segment from the last point back to the first
	_isClosed() {
		return false;
	}

	// Needed by the `Canvas` renderer for interactivity
	/**
	 * @param {Point} p
	 * @param {boolean} [closed]
	 */
	_containsPoint(p, closed) {
		const w = this._clickTolerance();

		if (!this._pxBounds?.contains(p)) { return false; }

		// hit detection for polylines
		for (const part of this._parts) {
			for (let j = closed ? 0 : 1, len = part.length; j < len; j++) {
				if (LineUtil.pointToSegmentDistance(p, part[(j || len) - 1], part[j]) <= w) {
					return true;
				}
			}
		}
		return false;
	}
}
