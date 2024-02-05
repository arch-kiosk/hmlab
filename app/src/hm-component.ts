import { unsafeCSS, LitElement, PropertyValues } from "lit";
import { html } from "lit/static-html.js";
import { customElement, property, state } from "lit/decorators.js";
import { fabric } from "fabric";
import { instance } from "@viz-js/viz";

// @ts-ignore
import local_css from "./styles/hm-component.sass?inline";
import {
    findBestHorizontalOrderForEdges,
    hmNode,
    Point,
    HMEdge,
    removeTransitiveRelationsFromNodes,
    positionHMEnds, mergeNewPositions,
} from "./lib/hm";
import { graphlib } from "dagre";
import Graph = graphlib.Graph;
import {
    getCSSVarColor,
    inDevelopmentMode,
    increase_brightness,
    RGBAColor,
    RGBToHex,
    RGBAToHexA,
    hexToRGB, RGBStrToRGB, RGBToHSB, increase_lightness, RGBAToHSL,
} from "./lib/applib";
import { AnyDict } from "./lib/hmlabtypes";

type HMPosition = {
    id: string,
    hmNodeIndex: number,
    x: number,
    y: number
}

type RowLaneInfo = {
    maxLanes: number
}

type RowInfo = {
    height: number
    screenY: number
}

type ColumnInfo = {
    maxLanes: number
    width: number
    screenX: number
    canMove: boolean
}

type ContemporaryEdge = {
    sourceNode: hmNode
    targetNode: hmNode
    edgeId: string //Combination of the node ids with a underscore, alphabetically sorted
    fabricLine: fabric.Group
    row: number
}


@customElement("hm-component")
export class HMComponent extends LitElement {
    static styles = unsafeCSS(local_css);
    _messages: { [key: string]: object } = {};

    @state()
    dotNotation: string | null = null;

    @property()
    hmNodes: Array<hmNode> | null = null;

    private hmGraph: Graph;
    private maxX?: number;
    private maxY?: number;
    private nodeWidth = 100;
    private nodeHeight = 40;
    private edgeWidth = 2;
    private edgeMargin = 2;
    private laneWidth = this.edgeWidth + this.edgeMargin * 2;
    private minColumnWidth = this.edgeWidth + this.edgeMargin * 2 * 3;
    private minEdgeRowHeight = this.edgeWidth * this.edgeMargin * 2;
    private edgeRowBorderHeight = 10;
    private showDummyNodes: boolean = false;
    private canvas: fabric.Canvas;
    private edgeColor: RGBAColor;
    private accentColor: RGBAColor;
    private nodeColor: RGBAColor;
    private nodeColorDarker: RGBAColor;
    private nodeTextColor: RGBAColor;
    private nodeColorAccent: RGBAColor;
    private nodeAccentTextColor: RGBAColor;
    static COLOR_STEPS: number = 10;
    private scrollBarHeight: number = 20; //That's just a fallback value
    private scrollBarWidth: number = 20; //That's just a fallback value
    private columnMargin: number = this.edgeMargin * 2;
    private fontHeight: number = 16; //That's just a falback value

    // @property()
    scale: number = 1.0;

    private backgroundColor: RGBAColor;

    @property()
    layout: AnyDict = {
        markContemporaries: true,
        contemporaryEdges: true,
        multiColorEdges: true,
        multiColorSelection: false,
        displayMode: "lightMode"
    };

    rows: Array<Array<HMEdge>> = [];
    edgeRowInfo: Array<RowLaneInfo> = [];
    columnInfo: Array<ColumnInfo> = [];
    rowInfo: Array<RowInfo> = [];
    private maxRow: number;
    private maxCol: number;
    private selectedNode: hmNode;
    private edgeColorRange: Array<string>;
    private accentColorRange: Array<string>;
    private contemporaryEdges: Array<ContemporaryEdge> = [];


    constructor() {
        super();
        this._messages = {};
    }

    firstUpdated(_changedProperties: any) {
        super.firstUpdated(_changedProperties);
    }

    layoutOption(option: string, defaultValue: any): any {

        if (this.layout && this.layout.hasOwnProperty(option)) {
            return this.layout[option];
        }
        return defaultValue;
    }

    _getCSSColors() {
        let colorRange = 30
        this.backgroundColor = getCSSVarColor("--hm-col-bg-body", "--col-bg-body", this);
        let lightness = RGBAToHSL([this.backgroundColor[0], this.backgroundColor[1], this.backgroundColor[2],1])[2]
        if (lightness < 50) {
            this.edgeColor = getCSSVarColor("--hm-col-primary-bg-body-dm", "--col-primary-bg-body-dm", this);
            this.accentColor = getCSSVarColor("--hm-col-warning-bg-body-dm","--col-warning-bg-body-dm", this);
        } else {
            this.edgeColor = getCSSVarColor("--hm-col-primary-bg-body", "--col-primary-bg-body", this);
            this.accentColor = getCSSVarColor("--hm-col-warning-bg-body","--col-warning-bg-body", this);
            colorRange = 50
        }
        if (this.layoutOption("multiColorEdges", true) && this.layoutOption("displayMode", "lightMode") !== "blackWhiteMode") {
            this.edgeColorRange = this._getHexColorRangeByBrightness(this.edgeColor, colorRange, HMComponent.COLOR_STEPS);
        } else {
            this.edgeColorRange = [RGBAToHexA(this.edgeColor)]
        }
        if (this.layoutOption("multiColorSelection", true) && this.layoutOption("displayMode", "lightMode") !== "blackWhiteMode") {
            this.accentColorRange = this._getHexColorRangeByBrightness(this.accentColor, colorRange, HMComponent.COLOR_STEPS);
        } else {
            this.accentColorRange = [RGBAToHexA(this.accentColor)]
        }

        this.nodeColor = getCSSVarColor("--hm-col-bg-1", "--col-bg-1", this);
        this.nodeColorDarker = getCSSVarColor("--hm-col-bg-1-darker","--col-bg-1-darker", this);
        this.nodeTextColor = getCSSVarColor("--hm-col-primary-bg-1","--col-primary-bg-1", this);
        this.nodeColorAccent = getCSSVarColor("--hm-col-bg-att","--col-bg-att", this);
        this.nodeAccentTextColor = getCSSVarColor("--hm-col-primary-bg-att","--col-primary-bg-att", this);
    }

    /**
     * _drawMatrix draws the helper matrix. Only for development purposes.
     */
    _drawMatrix() {
        this.columnInfo.forEach((col, colNr) => {
            colNr += 1;
            this.canvas.add(new fabric.Rect({
                left: col.screenX,
                top: 0,
                fill: col.canMove ? "#00AA0050" : "",
                stroke: "lightgrey",
                strokeWidth: 2,
                width: Math.max(col.width, 10),
                height: this.nodeHeight / 2 * this.scale,
                selectable: false,
                hoverCursor: "default",
                // backgroundColor: 'white'
            }));
            this.canvas.add(new fabric.Line([
                col.screenX,
                0,
                col.screenX,
                this._getHeight(),
            ], {
                stroke: "lightgrey",
                strokeWidth: 1,
                strokeDashArray: [5, 5],
                // width: 60 * this.scale,
                // height: 40 * this.scale,
                selectable: false,
                hoverCursor: "default",
            }));
            this.rowInfo.forEach((row, rowNr) => {
                rowNr += 1;
                this.canvas.add(new fabric.Rect({
                    left: col.screenX + 2,
                    top: row.screenY + 2,
                    fill: "",
                    stroke: "#00000020",
                    strokeWidth: 2,
                    width: Math.max(col.width - 2, 10),
                    height: row.height - 2,
                    selectable: false,
                    hoverCursor: "default",
                    // backgroundColor: 'white'
                }));
                this.canvas.add(new fabric.Line([
                    col.screenX,
                    row.screenY,
                    col.screenX + col.width,
                    row.screenY + row.height,
                ], {
                    stroke: "#00990010",
                    strokeWidth: 1,
                    strokeDashArray: [5, 5],
                    // width: 60 * this.scale,
                    // height: 40 * this.scale,
                    selectable: false,
                    hoverCursor: "default",

                }));
                this.canvas.add(new fabric.Line([
                    col.screenX + col.width,
                    row.screenY,
                    col.screenX,
                    row.screenY + row.height,
                ], {
                    stroke: "#00990010",
                    strokeWidth: 1,
                    strokeDashArray: [5, 5],
                    // width: 60 * this.scale,
                    // height: 40 * this.scale,
                    selectable: false,
                    hoverCursor: "default",

                }));
            });
        });
    }

    /**
     * _printHMNodes prints an analysis if the hmNodes to the console.
     * Only for developing purposes.
     */
    _printHMNodes() {
        if (!inDevelopmentMode())
            return;

        if (this.hmNodes) {
            for (const node of this.hmNodes) {
                for (const earlierId of node.earlierNodes) {
                    const earlierNode = this.hmNodes.find(x => x.id === earlierId);
                    if (!earlierNode)
                        console.warn(`${node.name}: can't find earlier node ${earlierId}`);
                }
                for (const nodeId of node.contemporaries) {
                    const contemporaryNode = this.hmNodes.find(x => x.id === nodeId);
                    if (contemporaryNode)
                        console.log(`"${node.name}"<->"${contemporaryNode.name}"`);
                    else
                        console.log(`${node.name}: can't find contemporary node ${nodeId}`);
                }
            }
        }
    }

    _buildHMNodesGraph() {
        this.hmGraph = new Graph({ multigraph: true });
        if (this.hmNodes) {
            let removedEdges = removeTransitiveRelationsFromNodes(this.hmNodes);
            this._printHMNodes();
            this.hmNodes.forEach((node) => {
                this.hmGraph.setNode(node.id, node.name ? node.name : "");
            });
            this.hmNodes.forEach((node) => {
                for (const earlierNodeId of node.earlierNodes) {
                    this.hmGraph.setEdge(node.id, earlierNodeId, { "type": "earlier" });
                }
                for (const contemporaryNodeId of node.contemporaries) {
                    this.hmGraph.setEdge(node.id, contemporaryNodeId, { "type": "contemporary" });
                }
            });
            removedEdges.forEach(e => {
                this.hmGraph.setEdge(e.v, e.w, { "type": "transitive" });
            });
        }
    }

    _HMNodes2Dot() {
        const subGraphs: Array<string> = [];
        const dotNodes: Map<string, string> = new Map();

        const dotHeader = `
        digraph {
            splines=spline\n
            concentrate=false\n
            layout=dot\n
            TBbalance="min"\n
            node [shape="rect"]
            edge [headport=n tailport=s]
            // nodesep=".5"\n
        `;
        let dotLines = "";

        if (this.hmNodes) {
            for (const node of this.hmNodes) {
                if (node.name)
                    dotNodes.set(node.id, node.name);

                for (const earlierNode of node.earlierNodes) {
                    dotLines += `\n"${node.id}"->"${earlierNode}"`;
                }
                if (node.contemporaries.length > 0) {
                    const subGraph = [node.id, ...node.contemporaries].sort();
                    const sameRank = subGraph.reduce((accumulator, v) => accumulator !== "" ? accumulator + `;"${v}"` : `"${v}"`, "");
                    if (subGraphs.findIndex(x => x === sameRank) == -1) {
                        subGraphs.push(sameRank);

                    }
                }
            }
            for (const sg of subGraphs) {
                const sameRankNodes = sg.split(";");
                let lastNode: string = "";
                for (const n of sameRankNodes) {
                    if (lastNode) {
                        dotLines += `\n${lastNode}->${n} [weight=2;minlen=2;tailport=_, headport=_;dir=both;color=lightgrey]`;
                    }
                    lastNode = n;
                }
                dotLines += `\nsubgraph {
                    rank = same;${sg}
                }`;
            }
            const dotFooter = `\n}`;

            let dotNodeLines = "";
            for (const dn of dotNodes)

                dotNodeLines += `"${dn[0]}" [label="${dn[1]}"]\n`;

            this.dotNotation = dotHeader + dotNodeLines + dotLines + dotFooter;
            // console.log(this.dotNotation)
        }
    }

    _renderJSON(json: any) {
        this.maxX = 0;
        this.maxY = 0;
        const c = 1.5;
        console.log(json);
        if (!this.hmNodes)
            return;
        const bb: string = json.bb;
        const bgDim = bb.split(",").map(x => parseFloat(x) * c);
        const svgWidth = bgDim[2];
        const svgHeight = bgDim[3];

        for (const node of json.objects) {
            const hmNode = this.hmNodes.find(x => x.id === node.name);
            if (hmNode) {
                const pos: Array<string> = node.pos.split(",");
                console.log(node);
                if (pos.length != 2) {
                    console.warn(`${node.name} with wrong pos attribute`);
                } else {
                    hmNode.pos = {
                        x: parseFloat(pos[0]) * c,
                        y: svgHeight - parseFloat(pos[1]) * c,
                    };
                    if (hmNode.pos.x > this.maxX) this.maxX = hmNode.pos.x;
                    if (hmNode.pos.y > this.maxY) this.maxY = hmNode.pos.y;
                }
            }
        }
    }

    /**
     * _alignToGrid is not being used, currently.
     */
    _alignToGrid() {
        //sort all nodes by x
        const NODE_WIDTH = 100;
        const WIGGLE_ROOM = 10;

        const hmPositions = this.hmNodes.map((n, index) => {
            return { idx: index, x: n.pos.x, y: n.pos.y };
        });
        hmPositions.sort((n1, n2) => n1.x - n2.x);

        let lastX = 0;
        let newX = 0;
        for (const pos of hmPositions) {
            if (pos.x - lastX > WIGGLE_ROOM) {
                newX += NODE_WIDTH;
                lastX = pos.x;
            }
            this.hmNodes[pos.idx].pos.x = newX;
        }
        this.maxX = newX + NODE_WIDTH;

        console.log(this.hmNodes.map((n, index) => {
            return { idx: index, x: n.pos.x, y: n.pos.y };
        }));
    }

    _alignToCells() {
        //sort all nodes by x
        // const NODE_WIDTH = 1
        const WIGGLE_ROOM = 10;

        // order all nodes by graphviz's X
        let hmPositions = this.hmNodes.map((n, index) => {
            return { idx: index, x: n.pos.x, y: n.pos.y };
        });
        hmPositions.sort((n1, n2) => n1.x - n2.x);

        let lastX = 0;
        let newX = -1;
        for (const pos of hmPositions) {
            if (pos.x - lastX > WIGGLE_ROOM) {
                newX += 2;
                lastX = pos.x;
            }
            this.hmNodes[pos.idx].pos.x = newX;
        }
        this.maxX = newX + 2;

        hmPositions.sort((n1, n2) => n1.y - n2.y);

        let lastY = 0;
        let newY = -1;
        for (const pos of hmPositions) {
            if (pos.y - lastY > WIGGLE_ROOM / 2) {
                newY += 2;
                lastY = pos.y;
            }
            this.hmNodes[pos.idx].pos.y = newY;
        }
        this.maxY = newY + 2;

        console.log(this.hmNodes.map((n, index) => {
            return { idx: index, x: n.pos.x, y: n.pos.y };
        }));
    }

    _hmGraphEdges2hmNodeEdges() {
        let newEdgeId = 0;

        this.hmNodes.forEach((node) => {
            for (const edge of this.hmGraph.outEdges(node.id)) {
                let edgeType = this.hmGraph.edge(edge).type;
                if (edgeType === "earlier") {
                    const targetNode = this.hmNodes.find((n) => n.id === edge.w);
                    const newEdge = <HMEdge>{
                        id: ++newEdgeId,
                        sourceId: node.id,
                        targetId: targetNode.id,
                        sourceNode: node,
                        targetNode: targetNode,
                        fromX: node.pos.x,
                        toX: targetNode.pos.x,
                        fromY: node.pos.y,
                        toY: targetNode.pos.y,
                        southX: -1,
                        lane: 1,
                        inOrder: 0,
                        outOrder: 0,
                        debug: node.name + "->" + targetNode.name,
                        colorIndex: 0,
                    };
                    node.outEdges.push(newEdge);
                    targetNode.inEdges.push(newEdge);
                }
            }
        });
        return newEdgeId;
    }

    _findHorizontalAlignment() {
        if (this.hmNodes.length == 0)
            return;

        //sort nodes by y and x
        let hmPositions = this.hmNodes.map((n, index) => {
            return <HMPosition>{ id: n.id, hmNodeIndex: index, x: n.pos.x, y: n.pos.y };
        });
        hmPositions.sort((n1, n2) => n1.y - n2.y == 0 ? n1.x - n2.x : n1.y - n2.y);
        let idx = 0;
        let newEdgeId = 0;
        let currentRow = 0;
        let rows: Array<Array<HMEdge>> = [];
        let rowEdges: Array<HMEdge> = [];
        let nodeRows: Array<Array<hmNode>> = [];

        currentRow = hmPositions[0].y;
        newEdgeId = this._hmGraphEdges2hmNodeEdges();
        let nodeRow: Array<hmNode> = [];
        //create and initialize all Edges and rows
        while (idx < hmPositions.length) {
            const hmPosition = hmPositions[idx];
            if (hmPosition.y == currentRow) {
                const sourceNode = this.hmNodes[hmPosition.hmNodeIndex];
                nodeRow.push(sourceNode);
                for (const edge of sourceNode.outEdges) {
                    const targetNode = this.hmNodes.find((n) => n.id === edge.targetId);
                    if (edge.toY - edge.fromY > 2) {
                        let originalEdge: HMEdge;
                        if (edge.dummyEdge) {
                            originalEdge = edge.originalEdge;
                        } else {
                            // originalEdge = { ...edge };
                            originalEdge = edge;
                        }
                        let southX = (edge.fromX < edge.toX) ? edge.toX - 1 : edge.toX + 1;
                        const dummyNode: hmNode = this._getOrInsertDummyNode(southX, edge.fromY + 2, hmPositions);
                        let outEdge: HMEdge = {
                            id: ++newEdgeId,
                            sourceId: dummyNode.id,
                            sourceNode: dummyNode,
                            targetNode: targetNode,
                            targetId: edge.targetId,
                            fromX: dummyNode.pos.x,
                            toX: edge.toX,
                            fromY: dummyNode.pos.y,
                            toY: edge.toY,
                            // southX: -1,
                            lane: 1,
                            dummyEdge: true,
                            extendsEdge: edge,
                            originalEdge: originalEdge,
                            colorIndex: -1,
                            inOrder: 0,
                            outOrder: 0,
                            debug: "",
                        } as HMEdge;
                        edge.nextEdge = outEdge;

                        dummyNode.outEdges.push(outEdge);
                        edge.toX = dummyNode.pos.x;
                        edge.toY = dummyNode.pos.y;
                        edge.targetId = dummyNode.id;
                        edge.targetNode = dummyNode;
                        dummyNode.inEdges.push(edge);
                        targetNode.inEdges.splice(targetNode.inEdges.findIndex(e => e.id === edge.id), 1, outEdge);
                    }
                    rowEdges.push(edge);
                }
                idx++;
            } else {
                rows.push(rowEdges);
                rowEdges = [];
                currentRow = hmPosition.y;
                nodeRows.push(nodeRow);
                nodeRow = [];
            }
        }
        if (rowEdges.length > 0) {
            rows.push(rowEdges);
        }
        nodeRows.push(nodeRow);

        let currentNodeRow = 0;
        for (const r of rows) {
            console.log(r);
            this._adjustEdgeEndsForRow(nodeRows[currentNodeRow], "in");
            r.forEach(edge => edge.outOrder = edge.extendsEdge ? edge.extendsEdge.inOrder : edge.outOrder);
            console.log(r);
            const laneOrder = findBestHorizontalOrderForEdges(r);
            for (const order of laneOrder) {
                r.find((e) => e.id === order.id).lane = order.order;
            }
            this._adjustEdgeEndsForRow(nodeRows[currentNodeRow++], "out");
            console.log(r);
        }
        this._adjustEdgeEndsForRow(nodeRows[currentNodeRow], "in");
        this.rows = rows;
    }

    _getOrInsertDummyNode(southX: number, posY: number, hmPositions: Array<HMPosition>) {
        let dummyNode: hmNode;
        let dummyNodeIndex = -1;

        for (let i = 0; i <= this.hmNodes.length - 1; i++) {
            dummyNode = this.hmNodes[i];
            if (dummyNode.pos.x == southX && dummyNode.pos.y == posY) {
                dummyNodeIndex = i;
                break;
            }
            dummyNode = undefined;
        }
        if (dummyNodeIndex == -1) {
            dummyNode = new hmNode(`_${southX}_${posY}`, [], []);
            dummyNode.pos = { x: southX, y: posY };
            dummyNode.name = "";
            dummyNode.dummyNode = true;
            this.hmNodes.push(dummyNode);
            dummyNodeIndex = this.hmNodes.length - 1;
            let index = hmPositions.findIndex((pos) => (pos.x > southX && pos.y == posY) || (pos.y > posY));
            let hmPosition: HMPosition = {
                id: dummyNode.id,
                hmNodeIndex: dummyNodeIndex,
                x: dummyNode.pos.x,
                y: dummyNode.pos.y,
            };
            if (index == -1) {
                this.hmGraph.setNode(dummyNode.id, "");
                hmPositions.push(hmPosition);
            } else {
                hmPositions.splice(index, 0, hmPosition);
            }
        }
        return dummyNode;
    }

    _adjustEdgeEndsForRow(nodes: Array<hmNode>, direction: "in" | "out") {
        if (!nodes)
            return;
        for (const node of nodes) {
            if (direction === "in") {
                let fixedEdges: Array<HMEdge>;
                let newEdges: Array<HMEdge>;

                if (node.dummyNode) {
                    fixedEdges = node.inEdges.filter(edge => edge.extendsEdge !== undefined);
                    newEdges = node.inEdges.filter(edge => edge.extendsEdge == undefined);
                } else {
                    fixedEdges = [];
                    newEdges = node.inEdges.filter(edge => true);
                }
                newEdges.sort((a, b) => {
                    let adif = (a.fromX - a.toX);
                    let bdif = (b.fromX - b.toX);
                    if (adif - bdif != 0)
                        return adif - bdif;
                    else return (adif < 0) ? b.lane - a.lane : a.lane - b.lane;

                    // return (a.originalEdge ? a.originalEdge.fromX - a.originalEdge.toX : a.fromX - a.toX) - (b.originalEdge ? b.originalEdge.fromX - b.originalEdge.toX : b.fromX - b.toX);
                });
                // let newPositions = positionHMEnds(newEdges.map((e) => e.originalEdge ? e.originalEdge.fromX - e.originalEdge.toX : e.fromX - e.toX));
                let newPositions = positionHMEnds(newEdges.map((e) => e.fromX - e.toX));
                newPositions = mergeNewPositions(fixedEdges.map(e => e.extendsEdge.inOrder), newPositions);
                newEdges.forEach((p, index) => p.inOrder = newPositions[index]);
                fixedEdges.forEach((p, index) => p.inOrder = p.extendsEdge.inOrder);
            } else {
                if (node.dummyNode) {
                    node.outEdges.forEach(edge => edge.outOrder = edge.extendsEdge.inOrder);
                } else {
                    node.outEdges.sort((a, b) => {
                        return (a.toX - a.fromX) - (b.toX - b.fromX);
                    });
                    let positions = positionHMEnds(node.outEdges.map((e) => e.toX - e.fromX));
                    positions.forEach((p, index) => node.outEdges[index].outOrder = positions[index]);
                }
            }
        }
    }

    _getColumnSpace(maxLanes: number) {
        return Math.max(this.minColumnWidth, maxLanes * (this.laneWidth + this.edgeMargin));
    }

    _calculateMaxLanesPerRow() {
        this.edgeRowInfo = [];
        this.rows.forEach((r, index) => {
            let maxLanes = 0;
            for (let edge of r) {
                if (edge.lane > maxLanes) maxLanes = edge.lane;
            }
            this.edgeRowInfo.push(<RowLaneInfo>{ maxLanes: maxLanes });
        });
    }

    _calculateWidthsPerColumn() {
        let usedColumns = new Map();
        let maxColumn = 0;
        let minColumn: number = 10;
        let maxRow: number = 0;
        let maxEdges: number = 0;

        this.hmNodes.forEach((n, index) => {
            if (n.dummyNode) {
                if (!usedColumns.has(n.pos.x)) usedColumns.set(n.pos.x, 0);
                if (usedColumns.get(n.pos.x) < n.inEdges.length)
                    usedColumns.set(n.pos.x, n.inEdges.length);
                if (n.inEdges.length > maxEdges)
                    maxEdges = n.inEdges.length;
            } else {
                usedColumns.set(n.pos.x, -1);
            }
            if (n.pos.x > maxColumn) maxColumn = n.pos.x;
            if (n.pos.x < minColumn) minColumn = n.pos.x;
            if (n.pos.y > maxRow) maxRow = n.pos.y;
        });

        let x = 0;
        let colWidth = this._getColumnSpace(maxEdges) + this.columnMargin * 2;
        for (let n = 1; n <= maxColumn; n++) {
            if (usedColumns.has(n)) {
                let maxLanes = usedColumns.get(n);
                // let maxLanes = maxEdges
                let width = maxLanes == -1 ? this.nodeWidth : colWidth;
                this.columnInfo.push({
                    maxLanes: maxLanes == -1 ? 0 : maxEdges, //maxLanes,
                    width: width,
                    screenX: x,
                    canMove: false,
                });
                x = x + width;
            } else {
                this.columnInfo.push({ maxLanes: 0, width: colWidth, screenX: x, canMove: false });
                x = x + colWidth;
            }
        }
        this.maxCol = maxColumn;
        this.maxRow = maxRow;
    }

    _calculateMatrix() {
        type matrixCell = { col: number, node: hmNode }
        let matrix: Array<Array<matrixCell>> = [];
        let moveMatrix: Array<Array<boolean>> = [];

        for (let r = 0; r <= this.maxRow; r++) {
            matrix.push([]);
            moveMatrix.push([]);
            for (let c = 0; c <= this.maxCol; c++) {
                matrix[r].push(null);
                moveMatrix[r].push(true);
            }
        }

        this.hmNodes.forEach((node, index) => {
            let rowNr = node.pos.y;
            let colNr = node.pos.x;
            matrix[rowNr][colNr] = { col: colNr, node: node };
            node.hasImmediateLeftRelation = this.nodeHasLeftDependency(node);
        });
        if (inDevelopmentMode()) {
            // matrix.forEach(r => console.log(r));
        }
        let debugStopAtCol = 45;

        let maxCol = this.maxCol;
        let currentCol = 3;
        while (currentCol <= maxCol) {
            let canMove = true;
            for (let row = 1; row <= this.maxRow; row++) {
                if (matrix[row][currentCol] && (matrix[row][currentCol - 2] || matrix[row][currentCol - 1])) {
                    canMove = false;
                    break;
                } else {
                    canMove = matrix[row][currentCol] ? !matrix[row][currentCol].node.hasImmediateLeftRelation : canMove;
                    if (canMove && currentCol < maxCol) {
                        if (matrix[row][currentCol + 1] && matrix[row][currentCol - 1]) {
                            canMove = false;
                            break;
                        } else {
                            // canMove = matrix[row][currentCol + 1] ? !matrix[row][currentCol + 1].node.hasImmediateLeftRelation : canMove
                        }
                    }
                    // if ((matrix[row][currentCol] && matrix[row][currentCol - 2]) || matrix[row][currentCol - 1]) {
                    //     canMove = false
                    // }
                    if (!canMove)
                        break;
                }
            }
            // canMove=false
            if (canMove) {
                for (let moveCol = currentCol - 2; moveCol <= maxCol - 2; moveCol++) {
                    for (let row = 1; row <= this.maxRow; row++) {
                        if (moveCol > currentCol - 1 || matrix[row][moveCol + 2]) matrix[row][moveCol] = matrix[row][moveCol + 2];
                    }
                }
                maxCol -= 2;
                debugStopAtCol -= 2;
            } else {
                currentCol += 1;
            }
        }
        for (let col = maxCol + 1; col <= this.maxCol; col++) {
            for (let row = 1; row <= this.maxRow; row++) {
                matrix[row][col] = null;
            }
        }
        if (inDevelopmentMode()) {
            console.log("--------------------------");
            matrix.forEach((row) => {
                console.log(row);
            });
        }
        let oldScreenX = this.columnInfo.map(col => col.screenX);
        let oldWidth = this.columnInfo.map(col => col.width);
        matrix.forEach(row => {
            row.forEach((cell, colNr) => {
                if (cell && cell.col > 0 && cell.col != colNr) {
                    // console.log(`moving column ${cell.col} to column ${colNr} from ${this.columnInfo[cell.col - 1].screenX} to ${oldScreenX[colNr - 1]}`);
                    this.columnInfo[cell.col - 1].screenX = oldScreenX[colNr - 1]; // + this.nodeWidth / 4
                    // this.columnInfo[colValue-1].width = Math.max(this.columnInfo[colValue-1].width, oldWidth[colNr-1]) // + this.nodeWidth / 4
                }
            });
        });
    }

    private nodeHasLeftDependency(testNode: hmNode) {
        if (testNode) {
            for (let edge of testNode.inEdges) {
                if (edge.sourceNode.pos.x == testNode.pos.x - 1) return true;
            }
            for (let edge of testNode.outEdges) {
                if (edge.targetNode.pos.x == testNode.pos.x - 1) return true;
            }
        }
        return false;
    }

    public refresh() {
        this.requestUpdate("color", "")
    }

    public deSelect() {
        if (this.selectedNode) this._selectNode()
    }

    _calculateLayout() {
        let row: number;
        let col: number;
        let lastRowNr = -1;
        let lastColNr = 1;
        let x = 100;
        let y = 0;

        this._calculateMaxLanesPerRow();
        this._calculateWidthsPerColumn();
        lastRowNr = -1;
        row = 0;
        this.rowInfo = [];
        for (row = 1; row <= this.maxRow; row++) {
            let rowHeight = this._getRowHeight(row);
            this.rowInfo.push({
                height: rowHeight,
                screenY: y,
            });
            y += rowHeight;
        }
        console.log(this.edgeRowInfo);
        console.log(this.rowInfo);
        console.log(this.columnInfo);
    }

    _tidyUp() {
        this.rows = [];
        this.edgeRowInfo = [];
        this.columnInfo = [];
        this.rowInfo = [];
        this.selectedNode = undefined;
        this.maxRow = undefined;
        this.maxCol = undefined;
        this.contemporaryEdges = [];
    }
    protected willUpdate(_changedProperties: PropertyValues) {
        super.willUpdate(_changedProperties);
    }

    updated(_changedProperties: any) {
        console.log("hm-component update", _changedProperties);
        super.updated(_changedProperties);
        let scrollBarCheck = this.shadowRoot.getElementById("scrollbar-calc");
        if (scrollBarCheck && scrollBarCheck.style.display != "none") {
            if ((scrollBarCheck.offsetHeight - scrollBarCheck.clientHeight) > 0) {
                this.scrollBarHeight = scrollBarCheck.offsetHeight - scrollBarCheck.clientHeight;
                this.scrollBarWidth = scrollBarCheck.offsetWidth - scrollBarCheck.clientWidth;
                console.log("Scrollbar", this.scrollBarHeight);
            }
            scrollBarCheck.style.display = "none";
        }
        if (_changedProperties.has("hmNodes")) {
            this._tidyUp();
            this._buildHMNodesGraph();
            this._HMNodes2Dot();
        } else {
            if (_changedProperties.has("color") || _changedProperties.has("layout")) {
                if (this.canvas) {
                    this._paintCanvas();
                    this._paintGraph();
                }
            }
        }
        if (_changedProperties.has("dotNotation") && (this.dotNotation)) {
            instance().then(viz => {
                const svg = viz.renderSVGElement(this.dotNotation);
                const json = viz.renderJSON(this.dotNotation);
                console.log(json);
                // this._paintSVG(svg.outerHTML);
                this._renderJSON(json);
                this._alignToCells();
                this._findHorizontalAlignment();
                this.hmNodes.sort((n1, n2) => (n1.pos.y == n2.pos.y) ? (n1.pos.x - n2.pos.x) : (n1.pos.y - n2.pos.y));
                // this._adjustEdgeEnds()

                this._calculateLayout();
                this._calculateMatrix();
                this._calcContemporaries();
                this.calcFinalMaxDimensions();
                this._paintCanvas();
                this._paintGraph();
            });
        }
    }

    getPointX(x: number) {
        return x * this.scale;
    }

    getPointY(y: number) {
        return 50 + y * this.scale;
    }

    _paintSVG(graphSVG: any) {
        const svg: HTMLDivElement = <HTMLDivElement>this.shadowRoot?.getElementById("svg");
        svg.innerHTML = graphSVG;
    }

    private calcFinalMaxDimensions() {
        this.maxX = 0;
        this.maxY = 0;
        for (let node of this.hmNodes) {
            let y = this.rowInfo[node.pos.y - 1].screenY + this.rowInfo[node.pos.y - 1].height;
            let x = this.columnInfo[node.pos.x - 1].screenX + this.columnInfo[node.pos.x - 1].width;
            if (x > this.maxX) this.maxX = x;
            if (y > this.maxY) this.maxY = y;
        }
        this.maxX = this.getPointX(this.maxX);
        this.maxY = this.getPointY(this.maxY);
    }

    _getHeight() {
        return this.maxY + this.scrollBarHeight;
    }

    _getWidth() {
        return this.maxX + this.scrollBarWidth;
    }

    _paintCanvas() {
        const el: HTMLCanvasElement = <HTMLCanvasElement>this.shadowRoot?.getElementById("c");
        this._getCSSColors();
        if (this.canvas) {
            this._disposeOfCanvas();
            this.selectedNode = undefined
        }
        this.canvas = new fabric.Canvas(el, {
            backgroundColor: RGBAToHexA(this.backgroundColor),
            width: this._getWidth(),
            height: this._getHeight(),
            selection: false,
        });
        this.canvas.on("mouse:down", (e) => {
            if (!e.target) {
                this._selectNode()
            }
        })
        let ctx = this.canvas.getContext();
        ctx.font = "bold 16px serif";
        let metrics = ctx.measureText("´§QW,");
        this.fontHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;

    }

    _getRowHeight(rowNr: number) {
        if (rowNr % 2 == 0) {
            rowNr = Math.trunc(rowNr / 2) - 1;
            return Math.max(this.minEdgeRowHeight, this.edgeRowBorderHeight * 2 + this.edgeRowInfo[rowNr].maxLanes * this.laneWidth);
        } else {
            return Math.max(this.nodeHeight);
        }
    }


    _drawRows() {

    }

    _disposeOfCanvas() {
        this.canvas.dispose();
        this.canvas = undefined;
    }

    repaint() {
        setTimeout(() => {
            this._disposeOfCanvas();
            console.log("repainting");
            this._paintCanvas();
            this._paintGraph();
        });
    }

    private _recolorNodeEdges(node: hmNode, colorRange: Array<string>, toFront=false) {
        if (!node)
            return;
        let edges = this._findAllEdgesForNode(node);
        edges.forEach((edge) => {
            let line = this._findLineForEdge(edge);
            if (line) {
                this.canvas.remove(line);
            }
            this._drawEdge(edge, colorRange, toFront);
        });
        this.canvas.requestRenderAll();
    }

    _getHexColorRangeByBrightness(baseColor: RGBAColor, range: number, steps: number) {
        let a = RGBAToHSL(baseColor)[2]
        let g = a/100
        let c = range * g
        let fromPercent = c * -1
        let toPercent = range - c
        let percentStep = Math.trunc(toPercent - fromPercent) / steps;
        let result: Array<string> = [];
        for (let prc = fromPercent; prc < toPercent; prc += percentStep) {
            result.push(RGBToHex(increase_lightness(baseColor, prc)));
        }
        return result;
    }

    _selectNode(node?: hmNode) {
        if (this.selectedNode === node) return;

        let oldSelectedNode = this.selectedNode;
        this.selectedNode = node;
        this.canvas.renderOnAddRemove = false;
        if (oldSelectedNode) {
            this._recolorNodeEdges(oldSelectedNode, this.edgeColorRange, false);
            this._repaintNode(oldSelectedNode);
        }

        let conEdges: Array<ContemporaryEdge> = [];
        this.contemporaryEdges.forEach(edge => {
            if (oldSelectedNode && (edge.sourceNode == oldSelectedNode || edge.targetNode == oldSelectedNode)) {
                if (edge.fabricLine) {
                    this.canvas.remove(edge.fabricLine);
                    edge.fabricLine = undefined;
                }
                this._drawContemporaryEdge(edge, this.edgeColor);
            }
            if (edge.sourceNode == this.selectedNode || edge.targetNode == this.selectedNode) {
                if (edge.fabricLine) {
                    this.canvas.remove(edge.fabricLine);
                    edge.fabricLine = undefined;
                }
                conEdges.push(edge);
            }
        });
        if (!this.selectedNode) return;
        this._recolorNodeEdges(this.selectedNode, this.accentColorRange, true);
        this._repaintNode(this.selectedNode);
        conEdges.forEach(e => this._drawContemporaryEdge(e, this.accentColor, true));
        this.canvas.renderOnAddRemove = true;
        this.canvas.requestRenderAll();

    }

    nodeClicked(option: {e:MouseEvent, target:fabric.Group}) {
        console.log("selected ", option.e);
        let group = option.target;
        this._selectNode(group.data)
        option.e.preventDefault()
    }

    _findGroupForNode(node: hmNode) {
        for (let object of this.canvas.getObjects("group")) {
            if (object.data && object.data === node) return object;
        }
        return undefined;
    }

    _findLineForEdge(edge: HMEdge) {
        for (let object of this.canvas.getObjects("polyline")) {
            if (object.data && object.data === edge) return object;
        }
        return undefined;
    }

    /**
     * finds all edge paths that either enter or exit a node onto the prior or next node.
     * @param node The node
     * @param edgeType "in" for only the in edges, "out" for only the out edges, "" (default) for both
     */
    _findAllEdgesForNode(node: hmNode, edgeType = "") {
        let edges = [];
        if (!node)
            return;
        if (!edgeType || edgeType === "in") {
            if (node.hasOwnProperty("inEdges")) {
                for (let e of node.inEdges) {
                    edges.push(e);
                    let priorEdge = e.extendsEdge;
                    while (priorEdge) {
                        edges.push(priorEdge);
                        priorEdge = priorEdge.extendsEdge;
                    }
                }
            }
        }
        if (!edgeType || edgeType === "out") {
            if (node.hasOwnProperty("outEdges")) {
                for (let e of node.outEdges) {
                    edges.push(e);
                    let nextEdge = e.nextEdge;
                    while (nextEdge) {
                        edges.push(nextEdge);
                        nextEdge = nextEdge.nextEdge;
                    }
                }
            }
        }

        return edges;
    }

    private _calcContemporaries() {
        this.contemporaryEdges = [];
        this.hmNodes.forEach((node, index) => {
            if (node.contemporaries && node.contemporaries.length > 0) {
                let contemporaries = node.contemporaries.map((nodeId) => {
                    return this.hmNodes.find(x => x.id === nodeId);
                });
                for (let conNode of contemporaries) {
                    let edgeId = node.id < conNode.id ? node.id + "_" + conNode.id : conNode.id + "_" + node.id;
                    if (node.pos.y != conNode.pos.y) {
                        console.log(`There is something wrong with the contemporary relation ${node.id} <-> ${conNode.id}`);
                    } else {
                        if (!this.contemporaryEdges.find(ce => ce.edgeId === edgeId)) {
                            this.contemporaryEdges.push({
                                edgeId: edgeId,
                                row: node.pos.y,
                                sourceNode: node,
                                targetNode: conNode,
                                fabricLine: undefined,
                            });
                            if (node.pos.x < conNode.pos.x) {
                                node.rightContemporary = conNode;
                                conNode.leftContemporary = node;
                            } else {
                                node.leftContemporary = conNode;
                                conNode.rightContemporary = node;

                            }
                        }
                    }
                }
                this.contemporaryEdges.sort((a, b) => {
                    return a.row != b.row ? a.row - b.row : a.sourceNode.pos.x - b.sourceNode.pos.x;
                });
            }
        });
    }

    _drawColumns() {
        this.columnInfo.forEach(col => {
            this.canvas.add(new fabric.Rect({
                left: this.getPointX(col.screenX),
                top: 0,
                fill: col.canMove ? "#00AA00" : "",
                stroke: "lightgrey",
                strokeWidth: 2,
                width: col.width,
                height: this.nodeHeight * this.scale,
                selectable: false,
                hoverCursor: "none",

                // backgroundColor: 'white'
            }));
            this.canvas.add(new fabric.Line([
                this.getPointX(col.screenX),
                0,
                this.getPointX(col.screenX),
                this._getHeight(),
            ], {
                stroke: "lightgrey",
                strokeWidth: 1,
                strokeDashArray: [5, 5],
                // width: 60 * this.scale,
                // height: 40 * this.scale,
                selectable: false,
                hoverCursor: "none",
            }));
        });
    }

    _repaintNode(node: hmNode) {
        if (!node.dummyNode) {
            let rowNr = node.pos.y;
            let colNr = node.pos.x;
            let x, y: number;
            try {
                x = this.columnInfo[colNr - 1].screenX;
                y = this.rowInfo[rowNr - 1].screenY;
            } catch (e) {
                console.log(`error for node ${node.name}: ${e}`);
                return;
            }
            let oldObject = this._findGroupForNode(node);
            if (oldObject) {
                console.log(`deleting old object for ${node.id}`);
                this.canvas.remove(oldObject);
            } else {
                console.log(`can't find old object for ${node.id}`);
            }
            console.log(`repainting node ${node.id}`);
            this._drawNode(node, x, y, rowNr, colNr);
        }

    }


    _paintGraph() {
        let rowNr: number;
        let colNr: number;
        let lastRowNr = 1;
        let lastColNr = 1;
        let x = 100;
        let y = 0;
        if (this.showDummyNodes) {
            this._drawColumns();
        }
        // this._drawColumns()
        // this._drawMatrix();
        let colorIndex = 0;
        this.hmNodes.forEach((node, index) => {
            rowNr = node.pos.y;
            colNr = node.pos.x;
            // if (node.contemporaries.length > 0) {
            //     node.leftContemporary = this.hmNodes.find(n => n.id === node.contemporaries[0])
            //     node.rightContemporary = this.hmNodes.find(n => n.id === node.contemporaries[0])
            // }
            for (let edge of node.outEdges) {
                if (!edge.dummyEdge) {
                    edge.colorIndex = colorIndex++;
                }
            }
            try {
                y = this.rowInfo[rowNr - 1].screenY;
                x = this.columnInfo[colNr - 1].screenX;
                this._drawNode(node, x, y, rowNr, colNr);
            } catch (e) {
                console.log(e);
                console.log(colNr, rowNr);
            }
        });
        if (this.layoutOption("contemporaryEdges", true)) {
            this.contemporaryEdges.forEach(edge => {
                this._drawContemporaryEdge(edge, this.edgeColor);
            });
        }
        this.rows.forEach(row => {
            row.forEach((edge, index) => {
                if (edge.originalEdge && edge.originalEdge.colorIndex) {
                    edge.colorIndex = edge.originalEdge.colorIndex;
                }
                this._drawEdge(edge, this.edgeColorRange);
            });
        });
    }

    _drawEdge(edge: HMEdge, colorRange: Array<string>, toFront=false) {
        let strokeWidth = 2;
        let start_x = this.columnInfo[edge.sourceNode.pos.x - 1].screenX + this.columnInfo[edge.sourceNode.pos.x - 1].width / 2;
        let start_y = this.rowInfo[edge.sourceNode.pos.y - 1].screenY + this.rowInfo[edge.sourceNode.pos.y - 1].height + 1;
        let dummy_start_y;
        let target_x = this.columnInfo[edge.targetNode.pos.x - 1].screenX + this.columnInfo[edge.targetNode.pos.x - 1].width / 2;
        let target_y = this.rowInfo[edge.targetNode.pos.y - 1].screenY;
        let origin = [this.getPointX(start_x), this.getPointY(start_y)];
        let target = [this.getPointX(target_x), this.getPointY(target_y)];
        let edgeColor = colorRange.length > 1 ? colorRange[edge.colorIndex % HMComponent.COLOR_STEPS] : colorRange[0];
        // if (edge.colorIndex < 0) edgeColor = edge.originalEdge.colorIndex?"red":"black"

        if (edge.dummyEdge) {
            dummy_start_y = this.getPointY(this.rowInfo[edge.sourceNode.pos.y - 1].screenY);
        }

        let lane = this.edgeRowBorderHeight + edge.lane * this.laneWidth;
        let outPos = (edge.outOrder) * this.laneWidth + this.edgeMargin;
        let inPos = (edge.inOrder) * this.laneWidth + this.edgeMargin;
        if (this.columnInfo[edge.sourceNode.pos.x - 1].screenX == this.columnInfo[edge.targetNode.pos.x - 1].screenX && outPos != inPos) {
            outPos = this.edgeMargin;
            inPos = this.edgeMargin;
        }
        let points = [
            new fabric.Point(origin[0] + outPos, edge.dummyEdge ? dummy_start_y : origin[1]),
            new fabric.Point(origin[0] + outPos, origin[1] + lane),
            new fabric.Point(target[0] + inPos, origin[1] + lane),
            new fabric.Point(target[0] + inPos, target[1]),
        ];
        let polyline = new fabric.Polyline(points, {
            stroke: edgeColor,
            strokeWidth: strokeWidth,
            fill: "",
            strokeLineJoin: "round",
            // strokeWidth: 20,            // width: 60 * this.scale,
            // height: 40 * this.scale,
            selectable: false,
            hoverCursor: "default",
            evented: false
        });

        polyline.data = edge;

        this.canvas.add(polyline);
        if (!toFront) {
            this.canvas.sendToBack(polyline);
        }

        // Just for development:
        /*
        this.canvas.add(new fabric.Textbox(edge.colorIndex.toString(), {
            left: origin[0] + outPos + (origin[0] + outPos > target[0] + inPos?strokeWidth:0),
            top: origin[1] + lane,
            stroke: "black",
            fontSize: 16,
            textAlign: "center",
            width: this.nodeWidth * this.scale,
            height: this.nodeHeight * this.scale,
            selectable: false,
            hoverCursor: "default"

        }));
        */
    }

    private _drawContemporaryEdge(edge: ContemporaryEdge, baseEdgeColor: RGBAColor, foreGround = false) {
        let edgeColor: RGBAColor = [baseEdgeColor[0], baseEdgeColor[1], baseEdgeColor[2], .7];
        let strokeWidth = 3;
        // y = this.rowInfo[rowNr - 1].screenY;
        // x = this.columnInfo[colNr - 1].screenX;
        let start_x = this.columnInfo[edge.sourceNode.pos.x - 1].screenX + this.columnInfo[edge.sourceNode.pos.x - 1].width;
        let start_y = 1 + this.rowInfo[edge.sourceNode.pos.y - 1].screenY + this.nodeHeight / 2;
        let target_x = this.columnInfo[edge.targetNode.pos.x - 1].screenX;
        let target_y = start_y;
        let group = [];

        let points = [
            new fabric.Point(this.getPointX(start_x), this.getPointY(start_y)),
            new fabric.Point(this.getPointX(target_x), this.getPointY(target_y)),
        ];

        let polyline = new fabric.Polyline(points, {
            stroke: RGBAToHexA(edgeColor),
            strokeWidth: foreGround ? 4 : strokeWidth,
            fill: "",
            // strokeWidth: 20,            // width: 60 * this.scale,
            // height: 40 * this.scale,
            strokeDashArray: [3, 3],
            selectable: false,
            hoverCursor: "default",
        });
        group.push(polyline);

        if (foreGround) {
            let triangle = new fabric.Triangle({
                left: this.getPointX(start_x),
                top: this.getPointY(target_y),
                originX: "center",
                originY: "center",
                width: this.nodeHeight / 4,
                height: this.nodeHeight / 4,
                angle: -90,
                stroke: RGBAToHexA(baseEdgeColor),
                fill: RGBAToHexA(baseEdgeColor),
            });
            group.push(triangle);
            triangle = new fabric.Triangle({
                left: this.getPointX(target_x) + 2,
                top: this.getPointY(target_y),
                originX: "center",
                originY: "center",
                width: this.nodeHeight / 4,
                height: this.nodeHeight / 4,
                angle: 90,
                stroke: RGBAToHexA(baseEdgeColor),
                fill: RGBAToHexA(baseEdgeColor),
            });
            group.push(triangle);
        }

        let conEdge = new fabric.Group(group, {
            selectable: false,
            evented: false,
            hasControls: false,
            hasBorders: false,
            lockMovementX: true,
            lockMovementY: true,
            hoverCursor: "default",
            data: edge,
        });
        this.canvas.add(conEdge);
        if (!foreGround)
            this.canvas.sendToBack(conEdge);
        edge.fabricLine = conEdge;
    }

    private _drawNode(node: hmNode, x: number, y: number, rowNr: number, colNr: number) {
        let origin = [this.getPointX(x), this.getPointY(y)];
        let halfHeight = this.nodeHeight * this.scale / 2;
        // let fill = this.moveMatrix[rowNr][colNr] ? "#00AA00" : "";
        let fill = "";
        if (node.dummyNode) {
            if (this.showDummyNodes) {
                this.canvas.add(new fabric.Rect({
                    left: origin[0],
                    top: origin[1],
                    fill: fill,
                    stroke: "lightgrey",
                    strokeWidth: 2,
                    width: this.columnInfo[colNr - 1].width,
                    height: this.nodeHeight * this.scale,
                    selectable: false,
                    // backgroundColor: 'white'
                }));
                this.canvas.add(new fabric.Textbox(node.name || node.id, {
                    left: origin[0],
                    top: origin[1],
                    stroke: "black",
                    fontSize: 16,
                    textAlign: "center",
                    width: this.nodeWidth * this.scale,
                    height: this.nodeHeight * this.scale,
                    selectable: false,
                }));
            }
            return this.nodeWidth;
        } else {
            let group: Array<fabric.Object> = [];
            group.push(new fabric.Rect({
                // left: origin[0],
                // top: origin[1],
                // originX: "center",
                // originY: "center",
                left: 0,
                top: 0,
                fill: RGBToHex(node != this.selectedNode ? this.nodeColor : this.nodeColorAccent),
                stroke: RGBToHex(node != this.selectedNode ? this.nodeColorDarker : this.nodeColorAccent),
                strokeWidth: 3,
                width: this.nodeWidth * this.scale,
                height: this.nodeHeight * this.scale,
                selectable: false,
                rx: 5,
                ry: 5,
            }));

            let text = new fabric.Textbox(node.name || node.id, {
                // left: origin[0],
                // top: origin[1],
                left: 0,
                top: this.nodeHeight * this.scale / 2 - this.fontHeight * this.scale / 2,
                stroke: RGBToHex(node != this.selectedNode ? this.nodeTextColor: this.nodeAccentTextColor),
                // originX: "center",
                // originY: "center",
                fontSize: 16,
                textAlign: "center",
                width: this.nodeWidth * this.scale,
                height: this.nodeHeight * this.scale,
                selectable: false,
            });
            group.push(text);

            if (this.layoutOption("markContemporaries", true)) {
                if (node.leftContemporary) {
                    group.push(new fabric.Rect({
                        left: 1,
                        top: (this.nodeHeight / 2 - this.nodeHeight / 8) * this.scale,
                        // originX: "left",
                        // originY: "center",
                        fill: RGBToHex(this.edgeColor),
                        stroke: RGBToHex(this.edgeColor),
                        strokeWidth: 2,
                        width: this.nodeHeight / 4 * this.scale,
                        height: this.nodeHeight / 4 * this.scale,
                        selectable: false,
                    }));
                }
                if (node.rightContemporary) {
                    group.push(new fabric.Rect({
                        left: (this.nodeWidth - this.nodeHeight / 4) * this.scale,
                        top: (this.nodeHeight / 2 - this.nodeHeight / 8) * this.scale,
                        // originX: "left",
                        // originY: "center",
                        fill: RGBToHex(this.edgeColor),
                        stroke: RGBToHex(this.edgeColor),
                        strokeWidth: 2,
                        width: this.nodeHeight / 4 * this.scale,
                        height: this.nodeHeight / 4 * this.scale,
                        selectable: false,
                    }));
                }
            }


            // if (inDevelopmentMode()) {
            //     group.push(new fabric.Textbox(node.shortId, {
            //         // left: origin[0],
            //         // top: origin[1]+20,
            //         originX: "center",
            //         originY: "center",
            //         stroke: "red",
            //         fontSize: 16,
            //         textAlign: "center",
            //         width: this.nodeWidth * this.scale,
            //         height: this.nodeHeight * this.scale,
            //         selectable: false
            //     }));
            // }

            let fGroup = new fabric.Group(group, {
                left: origin[0],
                top: origin[1],
                selectable: true,
                hasControls: false,
                hasBorders: false,
                // lockRotation: true,
                lockMovementX: true,
                lockMovementY: true,
                // lockScalingX: true,
                // lockScalingY: true,
                hoverCursor: "pointer",
            });
            fGroup.on("selected", this.nodeClicked.bind(this));
            fGroup.data = node;
            this.canvas.add(fGroup);

            return this.nodeWidth;
        }
    }

    render() {
        return html`
            <div id="scrollbar-calc"
                 style="background-color:red; height:50px;width:50px;overflow: scroll;visibility: hidden">
                <div style="height:100px;width:100px"></div>
            </div>
            <div class="adjacent">
                <div class="svg-div">
                    <div id="svg">

                    </div>
                </div>
                <canvas id="c">
                </canvas>
            </div>
        `;
    }

}

