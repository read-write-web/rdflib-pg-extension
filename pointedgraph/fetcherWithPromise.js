

///////////////////////////////////////////////////////////////////////////////////////////////
// fetcherWithPromise.js, part of rdflib-pg-extension.js made by Stample
// see https://github.com/stample/rdflib.js
///////////////////////////////////////////////////////////////////////////////////////////////

/*
TODO:
this proxification code is kind of duplicate of RDFLib's "crossSiteProxyTemplate" code.
How can we make this code be integrated in rdflib nicely?
*/


/**
 * Permits to know in which conditions we are using a CORS proxy (if one is configured)
 * @param uri
 */
$rdf.Fetcher.prototype.requiresProxy = function(url) {
    var isCorsProxyConfigured = $rdf.Fetcher.fetcherWithPromiseCrossSiteProxyTemplate;
    if ( !isCorsProxyConfigured ) {
        return false;
    }
    else {
        // /!\ this may not work with the original version of RDFLib
        var isUriAlreadyProxified = (url.indexOf($rdf.Fetcher.fetcherWithPromiseCrossSiteProxyTemplate) == 0);
        var isHomeServerUri = (url.indexOf($rdf.Fetcher.homeServer) == 0)
        if ( isUriAlreadyProxified || isHomeServerUri ) {
            return false;
        } else {
            return true;
        }
    }
}


/**
 * permits to proxify the URI
 * @param uri
 * @returns {string}
 */
$rdf.Fetcher.prototype.proxify = function(uri) {
    if ( uri && uri.indexOf('#') != -1 ) {
        throw new Error("Tit is forbiden to proxify an uri with a fragment:"+uri);
    }
    if ( uri && uri.indexOf($rdf.Fetcher.fetcherWithPromiseCrossSiteProxyTemplate) == 0 ) {
        throw new Error("You are trying to proxify an URL that seems to already been proxified!"+uri);
    }
    return $rdf.Fetcher.fetcherWithPromiseCrossSiteProxyTemplate + encodeURIComponent(uri);
};

/**
 * Permits to proxify an url if RDFLib is configured to be used with a CORS Proxy
 * @param url
 * @returns {String} the original url or the proxied url
 */
$rdf.Fetcher.prototype.proxifyIfNeeded = function(url) {
    if ( this.requiresProxy(url) ) {
        return this.proxify(url);
    } else {
        return url;
    }
}

$rdf.Fetcher.prototype.proxifySymbolIfNeeded = function(symbol) {
    $rdf.PG.Utils.checkArgument( $rdf.PG.Utils.isSymbolNode(symbol),"This is not a symbol!"+symbol);
    var url = $rdf.PG.Utils.symbolNodeToUrl(symbol);
    var proxifiedUrl = this.proxifyIfNeeded(url);
    return $rdf.sym(proxifiedUrl);
}






/**
 * Return the Promise of a pointed graph for a given url
 * @param {String} uri to fetch as string. The URI may contain a fragment because it results in a pointedGraph
 * @param {String} referringTerm the uri as string. Referring to the requested url
 * @param {boolean} force, force fetching of resource even if already in store
 * @param {options} options for the fetching operation (see rdflib #36)
 * @return {Promise} of a pointedGraph
 */
$rdf.Fetcher.prototype.fetch = function(uri, referringTerm, force, options) {
    var self = this;
    var uriSym = $rdf.sym(uri);
    var docUri = $rdf.PG.Utils.fragmentless(uri);
    var docUriSym = $rdf.sym(docUri);
    // The doc uri to fetch is the doc uri that may have been proxyfied
    var docUriToFetch = self.proxifyIfNeeded(docUri);
    var docUriToFetchSym = $rdf.sym(docUriToFetch);
    // if force mode enabled -> we previously unload so that uriFetchState will be "unrequested"
    if ( force ) {
        self.unload(docUriToFetchSym);
    }
    var uriFetchState = self.getState(docUriToFetch);
    // if it was already fetched we return directly the pointed graph pointing
    if (uriFetchState == 'fetched') {
        return Q.fcall(function() {
            return $rdf.pointedGraph(self.store, uriSym, docUriSym, docUriToFetchSym)
        });
    }
    // if it was already fetched and there was an error we do not try again
    // notice you can call "unload(symbol)" if you want a failed request to be fetched again if needed
    else if ( uriFetchState == 'failed') {
        return Q.fcall(function() {
            throw new Error("Previous fetch has failed for"+docUriToFetch+" -> Will try to fetch it again");
        });
    }
    // else maybe a request for this uri is already pending, or maybe we will have to fire a request
    // in both case we are interested in the answer
    else if ( uriFetchState == 'requested' || uriFetchState == 'unrequested' ) {
        if ( uriFetchState == 'requested') {
            console.debug("A request is already being done for",docUriToFetch," -> will wait for that response");
        }
        var deferred = Q.defer();
        self.addCallback('done', function fetchDoneCallback(uriFetched) {
            if ( docUriToFetch == uriFetched ) {
                deferred.resolve($rdf.pointedGraph(self.store, uriSym, docUriSym, docUriToFetchSym));
                return false; // stop
            }
            return true; // continue
        });
        self.addCallback('fail', function fetchFailureCallback(uriFetched, statusString, xhr) {
            if ( docUriToFetch == uriFetched ) {
                deferred.reject(new Error("Async fetch failure [uri="+uri+"][statusCode="+xhr.status+"][reason="+statusString+"]"));
                return false; // stop
            }
            return true; // continue
        });

        if (uriFetchState == 'unrequested') {
            var result = self.requestURI(docUriToFetch, referringTerm, force, options);
            if (result == null) {
                // TODO not sure of the effect of this line. This may cause the promise to be resolved twice no?
                deferred.resolve($rdf.pointedGraph(self.store, uriSym, docUriSym, docUriToFetchSym));
            }
        }
        return deferred.promise;
    }
    else {
        throw new Error("Unknown and unhandled uriFetchState="+uriFetchState+" - for URI="+uri)
    }

}