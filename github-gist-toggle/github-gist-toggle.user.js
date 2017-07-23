// ==UserScript==
// @name        ToggleGist
// @author      Kuba Niewiarowski
// @description Toggle files in GitHub Gist
// @namespace   jakub@niewiarowski.it
// @icon        https://github.com/favicon.ico
// @encoding    utf-8
// @include     /^https?:\/\/gist.github.com\/[\w-]+\/.*/
// @require     http://code.jquery.com/jquery-2.1.3.min.js
// @version     1.0
// ==/UserScript==

jQuery(function($) {
	function addBtn(){
		$('.file-box').each(function() {
			$('<a>', {
				class: 'btn btn-sm git-toggle-file',
				href:  '#',
				text:  'Toggle'
			}).click((e) => {
				e.preventDefault();
				$wrapper = $(e.target).parents('.file').find('.blob-wrapper, .blob').first();
				$wrapper.prop('hidden', !$wrapper.prop('hidden'));
			}).appendTo($(this).find('.file-actions .btn').parent());
		});
	}

	$().on("pjax:end", addBtn);

	addBtn();

});
