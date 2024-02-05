import { KioskApp } from "../kioskapplib/kioskapp";
import { nothing, PropertyValues, unsafeCSS } from "lit";
import { html, literal } from "lit/static-html.js";
import {provide} from '@lit-labs/context'
import { property, state } from "lit/decorators.js";
import "./hm-component"

// import { SlDropdown } from "@shoelace-style/shoelace";

// @ts-ignore
import local_css from "./styles/component-hmlab.sass?inline";
import { ApiLocusRelationsParameter } from "./lib/hmlabtypes";
import { getCSSVar, handleCommonFetchErrors } from "./lib/applib";
import { FetchException } from "../kioskapplib/kioskapi";
import { api2HmNodes, ApiResultLocusRelations } from "./lib/api2hmnodeshelper";
import { hmNode } from "./lib/hm";
import { getFACase, getAACase, getTestCase1, getTestCase2, getTestCaseStars } from "../test/data/testdata";
import { HMComponent } from "./hm-component";
import '@shoelace-style/shoelace/dist/components/dropdown/dropdown.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/menu-item/menu-item.js';
import '@shoelace-style/shoelace/dist/components/menu/menu.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';
import { setBasePath } from "@shoelace-style/shoelace/dist/utilities/base-path.js";
import { SlMenuItem } from "@shoelace-style/shoelace";

setBasePath("/static/sl_assets");


export class HmLabApp extends KioskApp {
    static styles = unsafeCSS(local_css);
    _messages: { [key: string]: object } = {};

    static properties = {
        ...super.properties,
    };

    private layoutOptions = {
        markContemporaries: true,
        contemporaryEdges: true,
        multiColorEdges: true,
        multiColorSelection: false,
        displayMode: "lightMode"
    }

    // noinspection JSUnresolvedReference

    // @provide({context: constantsContext})
    @state()
    relations: Array<hmNode> = []

    constructor() {
        super();
    }

    firstUpdated(_changedProperties: any) {
        console.log("App first updated.");
        super.firstUpdated(_changedProperties);
    }

    apiConnected() {
        console.log("api is connected");
        // this.fetchConstants();
    }


    protected reloadClicked(e: Event) {
        // let el = this.shadowRoot.getElementById("workstation-list")
        // el.shadowRoot.dispatchEvent(new CustomEvent("fetch-workstations", {
        //     bubbles: true,
        //     cancelable: false,
        // }))
        this.requestUpdate();
    }

    connectedCallback() {
        super.connectedCallback();
        this.shadowRoot.addEventListener("click", e => {
            e.stopPropagation()
            let hm = this.shadowRoot.querySelector("hm-component") as HMComponent
            if (e.target && (<HTMLElement>e.target).id === "kiosk-app" || (<HTMLElement>e.target).id === "hm-frame")
                hm.deSelect()
        })
        this.addEventListener("click", e => {
            let hm = this.shadowRoot.querySelector("hm-component") as HMComponent
            // if (hm && e.target && (<HTMLElement>e.target).id === "kiosk-app")
            hm.deSelect()
        })

    }

    protected loadMatrix(obj: ApiLocusRelationsParameter) {
        this.showProgress = true
        const urlSearchParams = new URLSearchParams();
        urlSearchParams.append("record_type", obj.record_type);
        urlSearchParams.append("identifier", obj.identifier);

        this.apiContext.fetchFromApi(
            "locusrelations",
            "relations",
            {
                method: "GET",
                caller: "app.fetchConstants",
            },
            "v1",
            urlSearchParams)
            .then((json: object) => {
                console.log("relations fetched");
                this.showProgress = false
                this.relations = [...api2HmNodes(json as ApiResultLocusRelations)]
                console.log(`relations fetched for ${obj.identifier}:`, this.relations)
            })
            .catch((e: FetchException) => {
                this.showProgress = false
                // handleFetchError(msg)
                handleCommonFetchErrors(this, e, "loadConstants", null);
            });    }



    private loadShortcut(event: MouseEvent) {
        const cell = <HTMLDivElement>event.currentTarget
        const identifier = cell.getAttribute("data-identifier")
        const tableName = cell.getAttribute("data-table-name")

        if (tableName === "-") {
            switch(identifier) {
                case "FA":
                    this.relations = [...getFACase()]
                    break;
                case "Test1":
                    this.relations = [...getTestCase1()]
                    break;
                case "Test2":
                    this.relations = [...getTestCase2()]
                    break;
                case "stars":
                    this.relations = [...getTestCaseStars()]
                    break;
            }
        } else {
        this.loadMatrix(
            {
                record_type: tableName,
                identifier: identifier
            });
        }
    }

    private goButtonClicked(event: MouseEvent) {
        const identifier = (this.renderRoot.querySelector("#devIdentifier") as HTMLInputElement).value
        this.loadMatrix(
            {
                record_type: "unit",
                identifier: identifier
            });
    }

    updated(_changedProperties: any) {
        super.updated(_changedProperties);
        console.log("updated: ", _changedProperties)
        if (_changedProperties.has("relations")) {
            if (this.apiContext) {
                const hm = this.renderRoot.querySelector("#hm")
                // @ts-ignore
                hm.hmNodes = this.relations
            }
        }
    }


    renderMatrix() {
        return html`
            <div id="hm-frame" class="hm-frame">
            <hm-component id="hm"></hm-component>
            </div>
        `
    }

    setBackgroundMode(hm:HMComponent, mode: string) {

        let bgColor = mode === "darkMode" ? getCSSVar("--col-bg-body-dm") : (mode === "lightMode" ? getCSSVar("--col-bg-body"):"#ffffff")
        hm.style.setProperty('background-color', 'var(--hm-col-bg-body, var(--col-bg-body))');
        this.style.setProperty('background-color', bgColor);
        hm.style.setProperty('--hm-col-bg-body', bgColor);
        if (mode === "blackWhiteMode") {
            hm.style.setProperty('--hm-col-accent-bg-body', '#000000')
            hm.style.setProperty('--hm-col-primary-bg-body', '#000000')
            hm.style.setProperty('--hm-col-warning-bg-body', '#000000')
            hm.style.setProperty('--hm-col-bg-1', '#ffffff')
            hm.style.setProperty('--hm-col-bg-1-darker', '#000000')
            hm.style.setProperty('--hm-col-bg-1-lighter', '#ffffff')
            hm.style.setProperty('--hm-col-primary-bg-1', '#000000')
            hm.style.setProperty('--hm-col-bg-att', '#000000')
            hm.style.setProperty('--hm-col-primary-bg-att', '#ffffff')
        } else {
            hm.style.setProperty('--hm-col-accent-bg-body', getCSSVar('--col-accent-bg-body'))
            hm.style.setProperty('--hm-col-primary-bg-body', getCSSVar('--col-primary-bg-body'))
            hm.style.setProperty('--hm-col-warning-bg-body', getCSSVar('--col-warning-bg-body'))
            hm.style.setProperty('--hm-col-bg-1', getCSSVar('--col-bg-1'))
            hm.style.setProperty('--hm-col-bg-1-darker', getCSSVar('--col-bg-1-darker'))
            hm.style.setProperty('--hm-col-bg-1-lighter', getCSSVar('--col-bg-1-lighter'))
            hm.style.setProperty('--hm-col-primary-bg-1', getCSSVar('--col-primary-bg-1'))
            hm.style.setProperty('--hm-col-bg-att', getCSSVar('--col-bg-att'))
            hm.style.setProperty('--hm-col-primary-bg-att', getCSSVar('--col-primary-bg-att'))
        }
        ["darkMode", "lightMode", "blackWhiteMode"].forEach((m) => {
            (this.shadowRoot.querySelector(`sl-menu-item[data-option="${m}"]`) as SlMenuItem).checked = m === mode;
        })
    }

    layoutItemSelected(event: CustomEvent) {
        let hm: HMComponent = this.shadowRoot.querySelector("hm-component")
        let newOptions = {...this.layoutOptions}

        switch (event.detail.item.dataset.option) {
            case "multiColorEdges":
                newOptions.multiColorEdges = event.detail.item.checked
                hm.layout = newOptions
                break;
            case "multiColorSelection": newOptions.multiColorSelection = event.detail.item.checked
                hm.layout = newOptions
                break;
            case "darkMode":
            case "lightMode":
            case "blackWhiteMode":
                this.setBackgroundMode(hm, event.detail.item.dataset.option)
                newOptions.displayMode = event.detail.item.dataset.option
                hm.layout = newOptions
                break;

        }
        this.layoutOptions = newOptions
    }

    protected renderToolbar() {
        return html`
            <div class="toolbar">
                <div id="toolbar-left">
                    <sl-dropdown>
                        <sl-button class="sl-bt-toolbar" size="small" slot="trigger" caret>layout options</sl-button>
                        <sl-menu @sl-select="${this.layoutItemSelected}">
                            <sl-menu-item data-option="multiColorEdges" type="checkbox" ?checked="${this.layoutOptions.multiColorEdges}">
                                <i class="fas text-gradient suffix-width" slot="prefix"></i>
                                multi colour edges
                            </sl-menu-item>
                            <sl-menu-item data-option="multiColorSelection" type="checkbox" ?checked="${this.layoutOptions.multiColorSelection}">
                                <i class="fas text-gradient suffix-width" slot="prefix"></i>
                                multi colour highlighting
                            </sl-menu-item>
                            <sl-divider style="--color: var(--col-bg-1);"></sl-divider>                            
                            <sl-menu-item data-option="darkMode" type="checkbox">
                                <span class="suffix-width" style="padding-top: 5px; display: inline-block" slot="prefix">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: rgba(0, 0, 0, 1);transform: ;msFilter:;"><path d="M20 4H4c-1.103 0-2 .897-2 2v10c0 1.103.897 2 2 2h4l-1.8 2.4 1.6 1.2 2.7-3.6h3l2.7 3.6 1.6-1.2L16 18h4c1.103 0 2-.897 2-2V6c0-1.103-.897-2-2-2zM5 13h4v2H5v-2z"></path></svg>
                                </span>
                                dark background
                            </sl-menu-item>
                            <sl-menu-item data-option="lightMode" type="checkbox" checked>
                                <span class="suffix-width" style="padding-top: 5px; display: inline-block" slot="prefix">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: rgba(0, 0, 0, 1);transform: ;msFilter:;"><path d="M20 3H4c-1.103 0-2 .897-2 2v11c0 1.103.897 2 2 2h4l-1.8 2.4 1.6 1.2 2.7-3.6h3l2.7 3.6 1.6-1.2L16 18h4c1.103 0 2-.897 2-2V5c0-1.103-.897-2-2-2zM4 16V5h16l.001 11H4z"></path><path d="M6 12h4v2H6z"></path></svg>
                                </span>
                                light background
                            </sl-menu-item>
                            <sl-menu-item data-option="blackWhiteMode" type="checkbox">
                                <i class="fas suffix-width" slot="prefix"></i>
                                black and white only
                            </sl-menu-item>
                        </sl-menu>
                    </sl-dropdown>
                </div>
                <div id="toolbar-buttons">
                    <!--<div class="toolbar-button" @click="${this.reloadClicked}">
                        <i class="fas fa-reload"></i>
                    </div>-->
                </div>
                <div></div>
            </div>`;
    }

    // apiRender is only called once the api is connected.
    apiRender() {
        let dev = html``;
        // @ts-ignore
        if (import.meta.env.DEV) {
            dev = html`
                <div>
                    <div class="logged-in-message">logged in! Api is at ${this.apiContext.getApiUrl()}</div>
                    <div class="dev-tool-bar"><label>Open identifier:</label>
                        <span class="dev-open-identifier"
                              data-identifier="CC"
                              data-table-name="unit"
                              @click="${this.loadShortcut}">CC</span>
                        <span class="dev-open-identifier"
                              data-identifier="CA"
                              data-table-name="unit"
                              @click="${this.loadShortcut}">CA</span>
                        <span class="dev-open-identifier"
                              data-identifier="FA"
                              data-table-name="unit"
                              @click="${this.loadShortcut}">FA</span>
                        <span class="dev-open-identifier"
                              data-identifier="FA"
                              data-table-name="-"
                              @click="${this.loadShortcut}">FA offline</span>
                        <span class="dev-open-identifier"
                              data-identifier="Test1"
                              data-table-name="-"
                              @click="${this.loadShortcut}">Test1</span>
                        <span class="dev-open-identifier"
                              data-identifier="Test2"
                              data-table-name="-"
                              @click="${this.loadShortcut}">Test2</span>
                        <span class="dev-open-identifier"
                              data-identifier="stars"
                              data-table-name="-"
                              @click="${this.loadShortcut}">stars</span>
                        <label for="identifier">unit:</label><input class="dev-open-identifier-input" id="devIdentifier" name="devIdentifier" type="text"/>
                        <button id="btGoto" @click="${this.goButtonClicked}">Go</button>
                    </div>
                </div>`;
        } else {
            dev = html`
                <div>
                    <div class="dev-tool-bar">
                        <label for="identifier">load unit:</label><input class="dev-open-identifier-input" id="devIdentifier" name="devIdentifier" type="text"/>
                        <button id="btGoto" @click="${this.goButtonClicked}">Go</button>
                    </div>
                </div>`;

        }
        let toolbar = this.renderToolbar();
        const app = html`${this.renderMatrix()}`
        return html`${dev}${toolbar}${app}`;
    }
}

window.customElements.define("hmlab-app", HmLabApp);
