import fetch from 'node-fetch'
import querystring, { ParsedUrlQueryInput } from 'querystring'
import { IBCMeta, HTTPMethods } from 'common/interfaces'

class BigCommerceClient {
    base: string
    headers: {
        'X-Auth-Token': string,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    }
    meta: IBCMeta
    debug: boolean
    status?: number
    maxAttempts: number
    timeout: number

    /**
     * Construct BigCommerceClient Instance.
     * @param {string} hash Store Hash (ex: gha3w9n1at)
     * @param {string} token API Token (ex: j3aovsvag3vg88hhyl4qt89q6ag2b6b)
     * @param {boolean} debug Enable console output for every request
     * @param {number} timeout Max time in millis for timeout (default: 15000)
     * @param {number} maxAttempts Number of retry attempts on timeout (default: 3)
     */
    constructor(hash: string, token: string, debug=false, timeout=15000, maxAttempts=3) {
        this.base = `https://api.bigcommerce.com/stores/${hash}/`
        this.headers = {
            'X-Auth-Token':token,
            'Accept':'application/json',
            'Content-Type':'application/json'
        }
        this.meta = {} as IBCMeta
        this.debug = debug
        this.status = undefined
        this.maxAttempts = maxAttempts
        this.timeout = timeout
    }

    /**
     * Performs a GET request to the BigCommerce Management API at the specified endpoint. Throws error w/ http status information if non-200 response is returned.
     * @returns {object} JSON data returned from a 2-- request
     * @param {string} endpoint Url endpoint from version onward (example: 'v3/catalog/products')
     * @param {object} queries Object w/ keys & string values of each url query parameter (example: {sku:'10205'})
     */
    get(endpoint: string, queries: ParsedUrlQueryInput={}): any {
        const url = `${this.base}${endpoint}?${querystring.stringify(queries)}`

        return this.readResponse(url)
    }

    /**
     * Function to perform on each page returned by endpoint. Should accept an array of objects from page.
     * @callback eachPage
     * @param {object[]} pageContents
     */

    /**
     * Performs sequential GET requests to the BigCommerce Management API at the specified endpoint. For each page in query it will perform the provided callback, passing an array of objects in page.
     * @async
     * @returns {null}
     * @param {string} endoint Url endpoint from version onward (example: 'v3/catalog/products')
     * @param {eachPage} eachPage Callback for each page provided by endpoint
     * @param {object} queries Object w/ keys & string values of each url query parameter (example: {sku:'10205'}). Page & limit can be passed to control start & page size.
     * @param {number} concurrency Amount of concurrent requests to make. Isn't a
     */
     async paginate(endpoint: string, eachPage: (page: Record<string, string>[]) => void, queries: ParsedUrlQueryInput={}, concurrency=3): Promise<void> {
        const page = await this.get(endpoint, queries)
        const current = this.meta.pagination.current_page
        let total = this.meta.pagination.total_pages

        eachPage(page)

        if (this.debug) console.log('CURRENT PAGE:', current, 'TOTAL PAGES:', total)
        if (current === total) return

        for (let current_page = current + 1; current_page <= total; current_page+=concurrency) {
            const pages = await Promise.all([ // Produces an array of concurrent request results
                ...(() => {
                    const requests = []
                    for (let count = 0; count < concurrency; count++) {
                        queries.page = current_page + count
                        if (queries.page <= total) // Skip requests outside of total pages
                            requests.push(this.get(endpoint, queries)) // Create one request per concurrency
                    }
                    return requests
                })()
            ])

            for (const page of pages) await eachPage(page)

            if (this.debug) console.log('CURRENT PAGE:', current_page, 'TOTAL PAGES:', total)
        }
    }

    /**
     * Performs sequential GET request to the BigCommerce Management API at the specified endpoint. Concatenates results from all pages.
     * @async
     * @returns {object[]} Concatenated JSON data returned from a 2-- request
     * @param {string} endpoint Url endpoint from version onward (example: 'v3/catalog/products')
     * @param {object} queries Object w/ keys & string values of each url query parameter (example: {sku:'10205'})
     */
    async getAll(endpoint: string, queries: ParsedUrlQueryInput={}) {
        let result: string[] = []

        await this.paginate(endpoint, (items: any)=> {
            result = result.concat(items)
        }, queries)

        return result
    }

    /**
     * Performs a POST request to the BigCommerce Management API at the specified endpoint. Throws error w/ http status information if non-200 response is returned.
     * @returns {object} JSON data returned from a 2-- request
     * @param {string} endpoint Url endpoint from version onward (example: 'v3/catalog/products')
     * @param {object} body Request body to be serialized and sent to endpoint
     */
    post(endpoint: string, body: Record<string, string>) {
        const url = `${this.base}${endpoint}`

        return this.readResponse(url, "POST",  JSON.stringify(body))
    }

    /**
     * Performs a PUT request to the BigCommerce Management API at the specified endpoint. Throws error w/ http status information if non-200 response is returned.
     * @returns {object} JSON data returned from a 2-- request
     * @param {string} endpoint Url endpoint from version onward (example: 'v3/catalog/products')
     * @param {object} body Request body to be serialized and sent to endpoint
     */
    put(endpoint: string, body: Record<string, string>) {
        const url = `${this.base}${endpoint}`

        return this.readResponse(url, "PUT",  JSON.stringify(body))
    }

    /**
     * Performs a DELETE request to the BigCommerce Management API at the specified endpoint. Throws error w/ http status information if non-200 response is returned.
     * @param {string} endpoint Url endpoint from version onward (example: 'v3/catalog/products')
     * @param {object} queries Object w/ keys & string values of each url query parameter (example: {sku:'10205'})
     */
    delete(endpoint: string, queries: ParsedUrlQueryInput={}) {
        const url = `${this.base}${endpoint}?${querystring.stringify(queries)}`
        return this.readResponse(url, "DELETE")
    }

    /**
     * Performs sequential DELETE requests to the BigCommerce Management API at the specified endpoint. Will perform a getAll request, then for each ID returned, it will perform a DELETE.
     * @async
     * @param {string} endpoint Url endpoint from version onward (example: 'v3/catalog/products')
     * @param {object} queries Object w/ keys & string values of each url query parameter (example: {sku:'10205'}).
     * @param {number} limit Amount of concurrent delete requests that will be performed. If the default setting of 3 errors out, set it to 1.
     */
     async deleteAll(endpoint: string, queries: ParsedUrlQueryInput={}, limit=3) {
        queries.limit = limit
        let items: any[] = await this.get(endpoint, queries)

        while (items.length) {
            await Promise.all(items.map((item)=>
                this.delete(endpoint + '/' + item.id)
            ))
            items = await this.get(endpoint, queries)
        }
    }

    async readResponse(url: string, method: HTTPMethods="GET", body: any=undefined, attempts=0): Promise<Record<string, string> | number> {
        if (this.debug) console.log(method, url)
        this.status = undefined;

        try {
            const response = await fetch(url, { method, headers: this.headers, timeout: this.timeout, body });
            this.status = response.status;

            if (!response.ok) {
                if (response.status >= 500 && attempts < this.maxAttempts)
                    return this.readResponse(url, method, body, attempts + 1)
                else
                    throw new Error(`${response.status} - ${response.statusText}: ${await response.text()}`);
            }

            const result = await response.text();

            if (result.length) {
                const body = JSON.parse(result)
                this.meta = body.meta
                return body.data ? body.data : body;
            } else return response.status;

        } catch(e) {
            throw e;
        }
    }
}

module.exports = BigCommerceClient
